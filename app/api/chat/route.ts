import { openai } from "@ai-sdk/openai";
import {
  Output,
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { runQiskit } from "@/lib/run-qiskit";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { CRITIC_PROMPT } from "@/lib/critic-prompt";
import { PlanSchema } from "@/lib/plan-schema";

export const maxDuration = 300;

const MODEL_ID = process.env.NAMEKOQ_MODEL ?? "gpt-5.5";
const CRITIC_MODEL_ID = process.env.NAMEKOQ_CRITIC_MODEL ?? MODEL_ID;

const requestPlanTool = tool({
  description: [
    "ユーザー要望から量子計算の実行計画を構造化して提出する (コミットメントポイント)。",
    "simulate_qiskit / simulate_pennylane / simulate_cirq のいずれかを呼ぶ前に **必ず最初に** これを通すこと。",
    "Zodスキーマで型・enum・単位・範囲が機械的にチェックされる。スキーマ違反のときはツール呼び出し自体が失敗するので、エラーを見て直して再提出する。",
    "意味的な妥当性 (アルゴリズム選択の良し悪し、パラメータの物理的妥当性等) は verify_intent_alignment で後段に判定される。",
  ].join("\n"),
  inputSchema: PlanSchema,
  execute: async (plan) => {
    console.log(
      "[request_plan] domain=%s framework=%s algo=%s qubits=%d",
      plan.domain,
      plan.framework,
      plan.algorithm,
      plan.qubits_estimate,
    );
    return {
      plan,
      next: "計画を受理しました。この plan に沿って選択された framework の Python コードを書き、対応する simulate tool を呼んでください。",
    };
  },
});

const simulationInputSchema = z.object({
  code: z.string().min(1).describe("実行するPythonコード全文"),
  purpose: z
    .string()
    .describe("このシミュレーションで何を確認したいか (短く)"),
});

function createSimulationTool({
  name,
  framework,
  simulator,
  codeRule,
}: {
  name: string;
  framework: "qiskit" | "pennylane" | "cirq";
  simulator: string;
  codeRule: string;
}) {
  return tool({
    description: [
      `${framework} 用の Python コードを ${simulator} で実行し、結果を返す。`,
      `plan.framework が "${framework}" の場合だけこの tool を使うこと。`,
      codeRule,
      "コードは標準出力の最後に JSON 互換の dict を print(...) すること。",
      "例: print({'counts': {'00': 512, '11': 512}, 'shots': 1024})",
      "注意: 別frameworkのコードや変換コードをこの tool に渡してはいけない。",
    ].join("\n"),
    inputSchema: simulationInputSchema,
    execute: async ({ code, purpose }) => {
      const started = Date.now();
      console.log("[%s] purpose=%s", name, purpose);
      const result = await runQiskit(code);
      console.log(
        "[%s] ok=%s ms=%d stderr_len=%d",
        name,
        result.ok,
        result.durationMs,
        result.stderr.length,
      );
      return {
        ok: result.ok,
        durationMs: result.durationMs,
        stdout: result.stdout.slice(-4000),
        stderr: result.stderr.slice(-4000),
        parsed: result.parsed ?? null,
        totalMs: Date.now() - started,
      };
    },
  });
}

const simulateQiskitTool = createSimulationTool({
  name: "simulate_qiskit",
  framework: "qiskit",
  simulator: "AerSimulator / qiskit-aer primitives",
  codeRule:
    "Qiskit + qiskit-aer のコードだけを渡すこと。AerSimulator、EstimatorV2、SamplerV2 などを使う。",
});

const simulatePennyLaneTool = createSimulationTool({
  name: "simulate_pennylane",
  framework: "pennylane",
  simulator: "default.qubit / lightning.qubit",
  codeRule:
    "PennyLane のコードだけを渡すこと。qml.device('default.qubit' または 'lightning.qubit') と @qml.qnode を使う。",
});

const simulateCirqTool = createSimulationTool({
  name: "simulate_cirq",
  framework: "cirq",
  simulator: "cirq.Simulator",
  codeRule:
    "Cirq のコードだけを渡すこと。cirq.Circuit、cirq.LineQubit、cirq.Simulator を使う。",
});

const verdictSchema = z.object({
  aligned: z
    .boolean()
    .describe("ユーザー要望と生成コード/結果がアルゴリズム・パラメータ・出力の観点で整合しているか"),
  confidence: z.enum(["high", "medium", "low"]).describe("判定への自信"),
  mismatches: z
    .array(
      z.object({
        aspect: z
          .string()
          .describe("ズレている観点 (例: bond_length, n_assets, algorithm_choice)"),
        expected: z.string().describe("ユーザーが意図したと思われる内容"),
        actual: z.string().describe("実際のコード/結果でそうなっている内容"),
      }),
    )
    .describe("具体的なズレ。alignedでも軽微な差異があれば含めてよい"),
  suggestions: z
    .array(z.string())
    .describe("aligned=false の場合の修正案。alignedなら空配列でよい"),
  summary: z.string().describe("1〜2文の総評 (日本語可)"),
});

const verifyIntentTool = tool({
  description: [
    "ユーザー要望と生成コード/実行結果が一致しているかを別人格のクリティックLLMに判定させる。",
    "simulate_qiskit / simulate_pennylane / simulate_cirq の対応toolが ok=true で結果を返した後、ユーザーに最終回答する前に **必ず** 呼ぶこと。",
    "aligned=false が返ったら、suggestions を参考にコードを修正して再度対応する simulate tool を呼び、その後再度このツールで検証する。",
  ].join("\n"),
  inputSchema: z.object({
    userRequest: z
      .string()
      .describe("ユーザーが最初に送った要望をそのままコピー"),
    interpretation: z
      .string()
      .describe("あなた(エージェント)が要望をどう解釈したか1-2文で"),
    plan: PlanSchema.describe(
      "request_plan で accepted=true だった計画オブジェクトをそのまま渡す",
    ),
    generatedCode: z
      .string()
      .describe("simulate_qiskit に渡した実際のコード全文"),
    result: z
      .unknown()
      .describe("simulate_qiskit の parsed 結果 (JSON互換の値)"),
  }),
  execute: async ({
    userRequest,
    interpretation,
    plan,
    generatedCode,
    result,
  }) => {
    const started = Date.now();
    console.log("[verify_intent] checking alignment...");
    try {
      const { experimental_output: verdict } = await generateText({
        model: openai(CRITIC_MODEL_ID),
        output: Output.object({ schema: verdictSchema }),
        system: CRITIC_PROMPT,
        prompt: [
          "## ユーザーの元の要望",
          userRequest,
          "",
          "## エージェントの解釈",
          interpretation,
          "",
          "## エージェントが提出した構造化計画 (request_planで受理済)",
          "```json",
          JSON.stringify(plan, null, 2),
          "```",
          "",
          "## エージェントが生成・実行したコード",
          "```python",
          generatedCode,
          "```",
          "",
          "## 実行結果 (parsed)",
          "```json",
          JSON.stringify(result, null, 2),
          "```",
          "",
          "次の3観点で整合性を判定してください:",
          "1. userRequest と plan の整合 (解釈ミス)",
          "2. plan と generatedCode の整合 (実装ミス)",
          "3. result が plan.success_criteria を満たしているか (実行結果の妥当性)",
        ].join("\n"),
      });
      console.log(
        "[verify_intent] aligned=%s confidence=%s mismatches=%d",
        verdict.aligned,
        verdict.confidence,
        verdict.mismatches.length,
      );
      return {
        ...verdict,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      console.error("[verify_intent] critic error:", err);
      return {
        aligned: false,
        confidence: "low" as const,
        mismatches: [],
        suggestions: [
          `クリティック呼び出しに失敗: ${err instanceof Error ? err.message : String(err)}。検証なしで進めるか、再試行してください。`,
        ],
        summary: "クリティックLLM呼び出しに失敗しました。",
        durationMs: Date.now() - started,
      };
    }
  },
});

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: openai(MODEL_ID),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      tools: {
        request_plan: requestPlanTool,
        simulate_qiskit: simulateQiskitTool,
        simulate_pennylane: simulatePennyLaneTool,
        simulate_cirq: simulateCirqTool,
        verify_intent_alignment: verifyIntentTool,
      },
      stopWhen: stepCountIs(10),
      onError: ({ error }) => {
        console.error("[chat] streamText error:", error);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("[chat] route error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
