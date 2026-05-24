import { createOpenAI, openai } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

export const maxDuration = 120;

const AppBuilderRequestSchema = z.object({
  openqasm: z.string().min(1),
  sourceCode: z.string().optional(),
  convertedCodes: z.record(z.string(), z.string()).optional(),
  customization: z.string().optional(),
  report: z.unknown().optional(),
});

const GeneratedAppSchema = z.object({
  title: z.string(),
  concept: z.string(),
  html: z.string(),
  usageNotes: z.array(z.string()),
});

export async function POST(req: Request) {
  try {
    const body = AppBuilderRequestSchema.parse(await req.json());
    const fallback = createFallbackApp(body);

    try {
      const model = resolveAppBuilderModel();
      if (!model) return Response.json(fallback);

      const generated = await generateAppJson({
        model,
        system: [
          "あなたはプロダクト視点を持つ量子アプリケーションビルダーです。",
          "量子アルゴリズムの目的と結果を使った、実用的な単一HTMLアプリを作成してください。",
          "単に回路を埋め込んだり表示するだけではなく、アルゴリズムのドメインに紐づく操作を提供してください。",
          "アプリは自己完結型にしてください。CSSとJavaScriptはinlineのみ、外部ネットワーク依存は禁止です。",
          "OpenQASMとソースコードは確認可能な成果物として含めてください。ただし主画面は実用的なワークフローを優先してください。",
          "落ち着いた業務向けUIを優先し、マーケティング文言は避けてください。",
          "必ず <!doctype html>, <html>, <head>, <body> を含む完全なHTMLを返してください。",
          "title, concept, html, usageNotes のキーを持つ有効なJSONのみを返してください。文言は日本語にしてください。",
        ].join("\n"),
        prompt: [
          "## 分析レポートJSON",
          JSON.stringify(body.report ?? null, null, 2).slice(0, 14000),
          "",
          "## OpenQASM",
          "```qasm",
          body.openqasm.slice(0, 12000),
          "```",
          "",
          "## ソースコード",
          "```python",
          (body.sourceCode ?? "").slice(0, 12000),
          "```",
          "",
          "## ユーザーのカスタム指示",
          body.customization?.trim() || "追加のカスタム指示なし。",
          "",
          "このアルゴリズムを実用的に使えるアプリを作ってください。例:",
          "- QAOA portfolio: 目的関数の再評価と選択資産の説明を含むポートフォリオ意思決定ダッシュボード。",
          "- MaxCut/QAOA: bitstringスコアを確認できるグラフカット探索アプリ。",
          "- VQE chemistry: パラメータと制約を含む分子エネルギーレポート/探索アプリ。",
          "- Grover: marked-stateと成功確率を確認する探索デモ。",
          "- QPE: 位相推定の計算/説明アプリ。",
          "- Bell/GHZ: エンタングルメント測定結果ビューア。",
        ].join("\n"),
      });

      return Response.json({
        ...generated,
        html: ensureCompleteHtml(generated.html, fallback.html),
      });
    } catch (err) {
      return Response.json({
        ...fallback,
        usageNotes: [
          ...fallback.usageNotes,
          `LLM app generation fallback used: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ],
      });
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

async function generateAppJson({
  model,
  system,
  prompt,
}: {
  model: LanguageModel;
  system: string;
  prompt: string;
}) {
  const { text } = await generateText({
    model,
    system,
    prompt: [
      prompt,
      "",
      "次の形の有効なJSONオブジェクトを1つだけ返してください:",
      JSON.stringify({
        title: "string",
        concept: "string",
        html: "完全な単一HTML文字列",
        usageNotes: ["string"],
      }),
      "JSONをmarkdown fenceで囲まないでください。",
    ].join("\n"),
  });
  return GeneratedAppSchema.parse(extractJsonObject(text));
}

function extractJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("モデルがparse可能なJSONオブジェクトを返しませんでした。");
  }
}

function resolveAppBuilderModel(): LanguageModel | null {
  if (process.env.OPENAI_API_KEY) {
    return openai(process.env.NAMEKOQ_APP_BUILDER_MODEL ?? process.env.NAMEKOQ_MODEL ?? "gpt-5.5");
  }

  if (process.env.DEEPSEEK_API_KEY) {
    const deepseek = createOpenAI({
      name: "deepseek",
      baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
      fetch: async (input, init) => {
        if (!init || typeof init.body !== "string") return fetch(input, init);
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          return fetch(input, {
            ...init,
            body: JSON.stringify({
              ...body,
              thinking:
                typeof body.thinking === "object" && body.thinking !== null
                  ? body.thinking
                  : { type: "disabled" },
            }),
          });
        } catch {
          return fetch(input, init);
        }
      },
    });
    return deepseek.chat(
      process.env.NAMEKOQ_DEEPSEEK_APP_BUILDER_MODEL ??
        process.env.NAMEKOQ_DEEPSEEK_MODEL ??
        "deepseek-v4-pro",
    );
  }

  return null;
}

function createFallbackApp(body: z.infer<typeof AppBuilderRequestSchema>) {
  const report = isRecord(body.report) ? body.report : {};
  const plan = isRecord(report.plan) ? report.plan : {};
  const simulation = isRecord(report.simulation) ? report.simulation : {};
  const result = isRecord(simulation.parsed) ? simulation.parsed : {};
  const algorithm = String(plan.algorithm ?? "Quantum");
  const title = `${algorithm} 意思決定アプリ`;
  const concept = fallbackConcept(algorithm);
  const html = buildFallbackHtml({
    title,
    concept,
    openqasm: body.openqasm,
    sourceCode: body.sourceCode ?? "",
    customization: body.customization ?? "",
    report,
    result,
  });

  return {
    title,
    concept,
    html,
    usageNotes: [
      "これは最終量子実行から生成された自己完結型プロトタイプです。",
      "量子結果を意思決定の成果物として使います。ブラウザ内で量子シミュレータは実行しません。",
      "実際の意思決定に使う前に、埋め込まれた前提を確認してください。",
    ],
  };
}

function fallbackConcept(algorithm: string) {
  if (/qaoa/i.test(algorithm)) {
    return "候補bitstring、量子計算で選ばれた選択肢、目的関数値を確認できる対話型意思決定ダッシュボード。";
  }
  if (/vqe/i.test(algorithm)) {
    return "推定エネルギー、変分パラメータ、モデル制約を確認する小さな実験レポート。";
  }
  if (/grover/i.test(algorithm)) {
    return "marked stateと観測された成功分布を強調する探索結果ビューア。";
  }
  if (/qpe|phase/i.test(algorithm)) {
    return "測定位相候補とターゲット解釈を比較する位相推定結果ビューア。";
  }
  if (/bell|ghz/i.test(algorithm)) {
    return "相関した測定結果と回路成果物を表示するエンタングルメント測定ビューア。";
  }
  return "対話的な結果確認と再現用成果物を含む小さな量子結果ビューア。";
}

function buildFallbackHtml({
  title,
  concept,
  openqasm,
  sourceCode,
  customization,
  report,
  result,
}: {
  title: string;
  concept: string;
  openqasm: string;
  sourceCode: string;
  customization: string;
  report: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const payload = JSON.stringify({
    report,
    result,
    openqasm,
    sourceCode,
    customization,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { margin: 0; background: #f7f7f5; color: #111; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; border-bottom: 1px solid #ddd; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .14em; color: #666; }
    p { line-height: 1.55; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; margin-top: 18px; }
    .panel { border: 1px solid #ddd; background: white; padding: 16px; border-radius: 6px; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .metric { border: 1px solid #e5e5e5; background: #fafafa; padding: 12px; border-radius: 4px; }
    .metric span { display: block; font-size: 11px; color: #666; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .metric strong { display: block; margin-top: 5px; font-size: 18px; word-break: break-word; }
    button { border: 1px solid #111; background: #111; color: white; border-radius: 4px; padding: 9px 12px; cursor: pointer; }
    button.secondary { background: white; color: #111; border-color: #bbb; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; }
    pre { max-height: 360px; overflow: auto; background: #f4f4f4; border: 1px solid #ddd; padding: 12px; border-radius: 4px; font-size: 12px; line-height: 1.5; }
    .hidden { display: none; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } main { padding: 16px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(concept)}</p>
      </div>
      <button onclick="copySummary()">サマリーをコピー</button>
    </header>
    <section class="grid">
      <div class="panel">
        <h2>意思決定ビュー</h2>
        <div id="decision"></div>
      </div>
      <aside class="panel">
        <h2>主要結果</h2>
        <div id="metrics" class="metric-grid"></div>
      </aside>
    </section>
    <section class="panel" style="margin-top:18px">
      <h2>成果物</h2>
      <button class="secondary" onclick="showArtifact('qasm')">OpenQASM</button>
      <button class="secondary" onclick="showArtifact('source')">ソースコード</button>
      <pre id="artifact"></pre>
    </section>
  </main>
  <script id="payload" type="application/json">${escapeScriptJson(payload)}</script>
  <script>
    const data = JSON.parse(document.getElementById('payload').textContent);
    const result = data.result || {};
    function fmt(value) {
      if (value === null || value === undefined) return '-';
      if (typeof value === 'number') return Number.isFinite(value) ? value.toPrecision(6) : String(value);
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    }
    function renderMetrics() {
      const entries = Object.entries(result).filter(([key]) => !/counts/i.test(key)).slice(0, 8);
      document.getElementById('metrics').innerHTML = entries.length
        ? entries.map(([key, value]) => '<div class="metric"><span>' + key + '</span><strong>' + fmt(value) + '</strong></div>').join('')
        : '<p>利用可能なスカラー結果フィールドはありません。</p>';
    }
    function renderDecision() {
      const counts = result.counts_top || result.counts || result.measurement_counts || {};
      const rows = Object.entries(counts).slice(0, 12);
      const selected = result.selected_assets || result.best_solution || result.best_bitstring || result.selection || null;
      document.getElementById('decision').innerHTML =
        '<p><strong>推奨出力:</strong> ' + fmt(selected) + '</p>' +
        (rows.length ? '<table><thead><tr><th>候補</th><th>Count / score</th></tr></thead><tbody>' +
        rows.map(([state, value]) => '<tr><td><code>' + state + '</code></td><td>' + fmt(value) + '</td></tr>').join('') +
        '</tbody></table>' : '<p>分布は利用できません。埋め込み成果物を確認してください。</p>');
    }
    function showArtifact(kind) {
      document.getElementById('artifact').textContent = kind === 'qasm' ? data.openqasm : data.sourceCode;
    }
    async function copySummary() {
      await navigator.clipboard.writeText(document.getElementById('decision').innerText);
    }
    renderMetrics();
    renderDecision();
    showArtifact('qasm');
  </script>
</body>
</html>`;
}

function ensureCompleteHtml(html: string, fallback: string) {
  const trimmed = html.trim();
  if (!trimmed.toLowerCase().includes("<html") || !trimmed.toLowerCase().includes("</html>")) {
    return fallback;
  }
  return trimmed;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeScriptJson(value: string) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
