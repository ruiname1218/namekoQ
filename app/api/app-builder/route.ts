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
          "You are a product-minded quantum application builder.",
          "Create a practical single-file HTML app that uses the purpose and results of a quantum algorithm.",
          "Do not merely embed or display the circuit. The app must expose an interaction tied to the algorithm's domain.",
          "The app must be self-contained: inline CSS and JavaScript only, no external network dependencies.",
          "The app must include the OpenQASM and source code as inspectable artifacts, but its primary screen must be a useful workflow.",
          "Prefer restrained, professional UI. Avoid marketing copy.",
          "Return complete HTML including <!doctype html>, <html>, <head>, and <body>.",
          "Return only valid JSON with keys: title, concept, html, usageNotes.",
        ].join("\n"),
        prompt: [
          "## Analysis report JSON",
          JSON.stringify(body.report ?? null, null, 2).slice(0, 14000),
          "",
          "## OpenQASM",
          "```qasm",
          body.openqasm.slice(0, 12000),
          "```",
          "",
          "## Source code",
          "```python",
          (body.sourceCode ?? "").slice(0, 12000),
          "```",
          "",
          "## User customization",
          body.customization?.trim() || "No extra customization.",
          "",
          "Build an app that makes this algorithm useful. Examples:",
          "- QAOA portfolio: interactive portfolio decision dashboard with objective rescoring and selected asset explanation.",
          "- MaxCut/QAOA: graph cut explorer with bitstring scoring.",
          "- VQE chemistry: molecule energy report/explorer with parameters and limitations.",
          "- Grover: marked-state search demonstrator with success probability.",
          "- QPE: phase-estimation calculator/explainer.",
          "- Bell/GHZ: entanglement measurement explorer.",
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
      "Return only one valid JSON object in this shape:",
      JSON.stringify({
        title: "string",
        concept: "string",
        html: "complete single-file HTML string",
        usageNotes: ["string"],
      }),
      "Do not wrap the JSON in markdown fences.",
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
    throw new Error("Model did not return a parseable JSON object.");
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
  const title = `${algorithm} Decision App`;
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
      "This is a self-contained prototype generated from the final quantum run.",
      "It uses the quantum result as a decision artifact; it does not run a quantum simulator in the browser.",
      "Review the embedded assumptions before using it for real decisions.",
    ],
  };
}

function fallbackConcept(algorithm: string) {
  if (/qaoa/i.test(algorithm)) {
    return "An interactive decision dashboard that lets users inspect candidate bitstrings, compare the quantum-selected option, and review the objective value.";
  }
  if (/vqe/i.test(algorithm)) {
    return "A compact experiment report for inspecting the estimated energy, variational parameters, and modeling limitations.";
  }
  if (/grover/i.test(algorithm)) {
    return "A search-result explorer that highlights the marked state and observed success distribution.";
  }
  if (/qpe|phase/i.test(algorithm)) {
    return "A phase-estimation result explorer for comparing measured phase candidates against the target interpretation.";
  }
  if (/bell|ghz/i.test(algorithm)) {
    return "An entanglement measurement explorer showing correlated outcomes and circuit artifacts.";
  }
  return "A compact quantum-result explorer with interactive result inspection and embedded reproducibility artifacts.";
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
      <button onclick="copySummary()">Copy Summary</button>
    </header>
    <section class="grid">
      <div class="panel">
        <h2>Decision View</h2>
        <div id="decision"></div>
      </div>
      <aside class="panel">
        <h2>Key Results</h2>
        <div id="metrics" class="metric-grid"></div>
      </aside>
    </section>
    <section class="panel" style="margin-top:18px">
      <h2>Artifacts</h2>
      <button class="secondary" onclick="showArtifact('qasm')">OpenQASM</button>
      <button class="secondary" onclick="showArtifact('source')">Source Code</button>
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
        : '<p>No scalar result fields were available.</p>';
    }
    function renderDecision() {
      const counts = result.counts_top || result.counts || result.measurement_counts || {};
      const rows = Object.entries(counts).slice(0, 12);
      const selected = result.selected_assets || result.best_solution || result.best_bitstring || result.selection || null;
      document.getElementById('decision').innerHTML =
        '<p><strong>Recommended output:</strong> ' + fmt(selected) + '</p>' +
        (rows.length ? '<table><thead><tr><th>Candidate</th><th>Count / score</th></tr></thead><tbody>' +
        rows.map(([state, value]) => '<tr><td><code>' + state + '</code></td><td>' + fmt(value) + '</td></tr>').join('') +
        '</tbody></table>' : '<p>No distribution was available. Inspect the embedded artifacts.</p>');
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
