import { createOpenAI, openai, type OpenAIProvider } from "@ai-sdk/openai";
import {
  Output,
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { runPythonSimulation } from "@/lib/run-python-simulation";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { CRITIC_PROMPT } from "@/lib/critic-prompt";
import { PlanSchema } from "@/lib/plan-schema";

export const maxDuration = 300;

const MAX_STEPS = 12;

type ModelTier = "default" | "pro";

interface ModelProfile {
  tier: ModelTier;
  label: string;
  provider: OpenAIProvider;
  modelId: string;
  criticModelId: string;
  openQasmModelId: string;
}

interface StructuredGenerationOptions<T> {
  profile: ModelProfile;
  modelId: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
}

const PRO_MODEL_ID = process.env.NAMEKOQ_MODEL ?? "gpt-5.5";
const PRO_CRITIC_MODEL_ID = process.env.NAMEKOQ_CRITIC_MODEL ?? PRO_MODEL_ID;
const PRO_OPENQASM_MODEL_ID =
  process.env.NAMEKOQ_OPENQASM_MODEL ?? PRO_MODEL_ID;
const DEEPSEEK_MODEL_ID =
  process.env.NAMEKOQ_DEEPSEEK_MODEL ?? "deepseek-v4-pro";
const DEEPSEEK_CRITIC_MODEL_ID =
  process.env.NAMEKOQ_DEEPSEEK_CRITIC_MODEL ?? DEEPSEEK_MODEL_ID;
const DEEPSEEK_OPENQASM_MODEL_ID =
  process.env.NAMEKOQ_DEEPSEEK_OPENQASM_MODEL ?? DEEPSEEK_MODEL_ID;
const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

function parseModelTier(value: unknown): ModelTier {
  return value === "pro" ? "pro" : "default";
}

function resolveModelProfile(tier: ModelTier): ModelProfile {
  if (tier === "pro") {
    return {
      tier,
      label: "GPT-5.5",
      provider: openai,
      modelId: PRO_MODEL_ID,
      criticModelId: PRO_CRITIC_MODEL_ID,
      openQasmModelId: PRO_OPENQASM_MODEL_ID,
    };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Default / DeepSeek V4 Pro を使うには DEEPSEEK_API_KEY が必要です。",
    );
  }

  return {
    tier,
    label: "DeepSeek V4 Pro",
    provider: createOpenAI({
      name: "deepseek",
      baseURL: DEEPSEEK_BASE_URL,
      apiKey,
      fetch: deepSeekCompatibilityFetch,
    }),
    modelId: DEEPSEEK_MODEL_ID,
    criticModelId: DEEPSEEK_CRITIC_MODEL_ID,
    openQasmModelId: DEEPSEEK_OPENQASM_MODEL_ID,
  };
}

function selectLanguageModel(
  profile: ModelProfile,
  modelId: string,
): LanguageModel {
  if (profile.tier === "default") return profile.provider.chat(modelId);
  return profile.provider(modelId);
}

const deepSeekCompatibilityFetch: typeof fetch = async (input, init) => {
  const nextInit = addDeepSeekCompatibilityBody(init);
  return fetch(input, nextInit);
};

function addDeepSeekCompatibilityBody(init: RequestInit | undefined) {
  if (!init || typeof init.body !== "string") return init;

  try {
    const body = JSON.parse(init.body) as unknown;
    if (!isRecord(body)) return init;
    return {
      ...init,
      body: JSON.stringify({
        ...body,
        thinking: isRecord(body.thinking)
          ? body.thinking
          : { type: "disabled" },
      }),
    };
  } catch {
    return init;
  }
}

async function generateStructuredObject<T>({
  profile,
  modelId,
  schema,
  system,
  prompt,
}: StructuredGenerationOptions<T>): Promise<T> {
  const model = selectLanguageModel(profile, modelId);

  if (profile.tier !== "default") {
    const { experimental_output } = await generateText({
      model,
      output: Output.object({ schema }),
      system,
      prompt,
    });
    return experimental_output;
  }

  const { text } = await generateText({
    model,
    system: [
      system,
      "",
      "要求されたschemaに一致する有効なJSONオブジェクトを1つだけ返してください。",
      "JSONをmarkdown fenceで囲まないでください。補足説明も含めないでください。",
    ].join("\n"),
    prompt: [
      prompt,
      "",
      "JSON schemaの形:",
      schemaDescription(schema),
      "",
      "有効なJSONのみを返してください。",
    ].join("\n"),
  });

  return schema.parse(extractJsonObject(text));
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

function schemaDescription(schema: z.ZodType<unknown>): string {
  if (schema === verdictSchema) {
    return JSON.stringify({
      aligned: "boolean",
      confidence: "high | medium | low",
      mismatches: [{ aspect: "string", expected: "string", actual: "string" }],
      suggestions: ["string"],
      summary: "string",
    });
  }
  if (schema === openQasmPreparationSchema) {
    return JSON.stringify({
      extractionCode: "string",
      notes: ["string"],
    });
  }
  return "{}";
}

const requestPlanTool = tool({
  description: [
    "ユーザー要望から量子計算の実行計画を構造化して提出する。",
    "simulate_qiskit / simulate_pennylane / simulate_cirq の前に必ず最初に呼ぶこと。",
    "Zod schemaで型、enum、単位、範囲を確認する。validationに失敗した場合はtool callを修正して再提出する。",
    "意味的な妥当性は後段の verify_intent_alignment で確認する。",
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
      next: "計画を受理しました。このplanに沿って選択されたframeworkのPythonコードを書き、対応するsimulation toolを呼んでください。",
    };
  },
});

const simulationInputSchema = z.object({
  code: z.string().min(1).describe("実行するPythonコード全文"),
  purpose: z
    .string()
    .describe("このシミュレーションで確認したいことを短く書く"),
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
      `Run ${framework} Python code with ${simulator} and return the result.`,
      `Use this tool only when plan.framework is "${framework}".`,
      codeRule,
      "コードはstdoutの最後の行にJSON互換のdictをprintすること。",
      "例: print({'counts': {'00': 512, '11': 512}, 'shots': 1024})",
      "別frameworkのコードや変換wrapper codeをこのtoolに渡してはいけない。",
    ].join("\n"),
    inputSchema: simulationInputSchema,
    execute: async ({ code, purpose }) => {
      const started = Date.now();
      console.log("[%s] purpose=%s", name, purpose);
      const result = await runPythonSimulation(code);
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
  simulator: "Aer qasm / statevector / density matrix / MPS / qiskit-aer primitives",
  codeRule:
    "Qiskit + qiskit-aer のコードだけを渡すこと。AerSimulator(), AerSimulator(method='statevector'), AerSimulator(method='density_matrix'), AerSimulator(method='matrix_product_state'), EstimatorV2, SamplerV2 などを使う。",
});

const simulatePennyLaneTool = createSimulationTool({
  name: "simulate_pennylane",
  framework: "pennylane",
  simulator: "default.qubit / default.mixed / lightning.qubit",
  codeRule:
    "PennyLane のコードだけを渡すこと。qml.device('default.qubit' / 'default.mixed' / 'lightning.qubit') と @qml.qnode を使う。",
});

const simulateCirqTool = createSimulationTool({
  name: "simulate_cirq",
  framework: "cirq",
  simulator: "cirq.Simulator / DensityMatrixSimulator / CliffordSimulator",
  codeRule:
    "Cirq のコードだけを渡すこと。cirq.Circuit, cirq.LineQubit, cirq.Simulator / cirq.DensityMatrixSimulator / cirq.CliffordSimulator を使う。CliffordSimulator はClifford回路だけに使う。",
});

const verdictSchema = z.object({
  aligned: z
    .boolean()
    .describe("ユーザー要望、生成コード、結果がアルゴリズム・パラメータ・出力の観点で整合しているか"),
  confidence: z.enum(["high", "medium", "low"]).describe("判定への自信"),
  mismatches: z
    .array(
      z.object({
        aspect: z
          .string()
          .describe("ズレている観点。例: bond_length, n_assets, algorithm_choice"),
        expected: z.string().describe("ユーザーが意図したと思われる内容"),
        actual: z.string().describe("コード/結果が実際に行った内容"),
      }),
    )
    .describe("具体的なズレ。aligned=trueでも有用なら軽微なズレを含めてよい"),
  suggestions: z
    .array(z.string())
    .describe("aligned=falseの場合の修正案。aligned=trueなら空配列にする"),
  summary: z.string().describe("1〜2文の日本語サマリー"),
});

function createVerifyIntentTool(profile: ModelProfile, getStepsUsed: () => number) { // getStepsUsed: for logging only
  return tool({
  description: [
    "独立したcritic LLMに、生成コード/結果がユーザー要望と一致しているか判定させる。",
    "対応するsimulation toolがok=trueを返した後、最終回答の前に呼ぶこと。",
    "aligned=falseの場合はsuggestionsを参考にコードを修正し、再シミュレーションして再検証する。",
    "aligned=trueの場合は次にconvert_to_openqasmを呼ぶこと。",
  ].join("\n"),
  inputSchema: z.object({
    userRequest: z
      .string()
      .describe("ユーザーの元の要望をそのままコピーする"),
    interpretation: z
      .string()
      .describe("要望をどう解釈したか1〜2文で説明する"),
    plan: PlanSchema.describe(
      "request_planで受理されたplanオブジェクトをそのまま渡す",
    ),
    generatedCode: z
      .string()
      .describe("対応するsimulation toolへ渡した実際のコード全文"),
    result: z
      .unknown()
      .describe("対応するsimulation toolのparsed結果"),
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
      const verdict = await generateStructuredObject({
        profile,
        modelId: profile.criticModelId,
        schema: verdictSchema,
        system: CRITIC_PROMPT,
        prompt: [
          "## ユーザーの元の要望",
          userRequest,
          "",
          "## エージェントの解釈",
          interpretation,
          "",
          "## request_planで受理された構造化計画",
          "```json",
          JSON.stringify(plan, null, 2),
          "```",
          "",
          "## 生成・実行されたコード",
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
          "3. result が plan.success_criteria を満たしているか (結果の妥当性)",
        ].join("\n"),
      });
      const stepsUsed = getStepsUsed();
      console.log(
        "[verify_intent] aligned=%s confidence=%s mismatches=%d steps_used=%d",
        verdict.aligned,
        verdict.confidence,
        (verdict.mismatches ?? []).length,
        stepsUsed,
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
          `critic呼び出しに失敗: ${err instanceof Error ? err.message : String(err)}。検証なしで進めるか、再試行してください。`,
        ],
        summary: "critic LLM呼び出しに失敗しました。",
        durationMs: Date.now() - started,
      };
    }
  },
  });
}

const openQasmPreparationSchema = z.object({
  extractionCode: z
    .string()
    .min(1)
    .describe("FINAL_CIRCUITを定義するOpenQASM抽出専用Pythonコード"),
  notes: z
    .array(z.string())
    .describe("抽出コードが表現する範囲と制約。なければ空配列"),
});

const openQasmInputSchema = z.object({
  framework: z.enum(["qiskit", "pennylane", "cirq"]),
  generatedCode: z.string().min(1).describe("実行・検証済みの最終Pythonコード"),
  plan: PlanSchema.describe("request_planで受理されたplan"),
  result: z.unknown().describe("simulation toolのparsed結果"),
});

function createConvertToOpenQasmTool(profile: ModelProfile) {
  return tool({
  description: [
    "実行・検証済みの最終コードからOpenQASMを抽出する。",
    "verify_intent_alignment が aligned=true を返した後、最終回答の前に呼ぶこと。",
    "このtool内では、LLMがOpenQASM抽出専用の別Pythonコードを作る。",
    "LLMはOpenQASM文字列を直接書いてはいけない。公式framework APIで機械的に生成する。",
    "OpenQASM変換を簡単にするために、メインの最終コードを単純化してはいけない。",
  ].join("\n"),
  inputSchema: openQasmInputSchema,
  execute: async ({ framework, generatedCode, plan, result }) => {
    const started = Date.now();
    console.log("[convert_to_openqasm] framework=%s", framework);

    try {
      const prepared = await generateStructuredObject({
        profile,
        modelId: profile.openQasmModelId,
        schema: openQasmPreparationSchema,
        system: [
          "あなたは量子プログラムからOpenQASM抽出コードを書くエンジニアです。",
          "OpenQASM文字列を直接書かず、Pythonコードだけを書いてください。",
          "目的は、元の最終コードとは別に、OpenQASMへ機械的に変換できる FINAL_CIRCUIT という回路オブジェクトを定義することです。",
          "ユーザー回答に使った最終コードを単純化・置換してはいけません。実際に使った主要回路、ansatz、測定回路を抽出してください。",
          "VQE/QAOAなどでは、古典最適化、Hamiltonian、後処理をOpenQASMで完全に表現できない場合があります。量子回路部分だけを抽出し、制約をnotesに書いてください。",
          "コードはstandaloneにし、print、file I/O、pip installを使わないでください。",
          "Qiskitでは FINAL_CIRCUIT は qiskit.QuantumCircuit である必要があります。",
          "Cirqでは FINAL_CIRCUIT は cirq.Circuit である必要があります。",
          "PennyLaneでは FINAL_CIRCUIT は引数なしの qml.QNode である必要があります。",
        ].join("\n"),
        prompt: [
          "## framework",
          framework,
          "",
          "## plan",
          "```json",
          JSON.stringify(plan, null, 2),
          "```",
          "",
          "## simulate parsed result",
          "```json",
          JSON.stringify(result, null, 2),
          "```",
          "",
          "## final generated code",
          "```python",
          generatedCode,
          "```",
          "",
          "この最終コードとは別にOpenQASM抽出コードを作成してください。",
          "必ず FINAL_CIRCUIT を定義してください。",
        ].join("\n"),
      });

      const conversionCode =
        prepared.extractionCode.trim() +
        "\n\n" +
        createOpenQasmPostlude(framework);
      const run = await runPythonSimulation(conversionCode);
      const parsed = isRecord(run.parsed) ? run.parsed : {};
      const openqasm =
        typeof parsed.openqasm === "string" ? parsed.openqasm : undefined;
      const fallbackOpenqasm =
        typeof parsed.fallback_openqasm === "string"
          ? parsed.fallback_openqasm
          : undefined;
      const openqasmError =
        typeof parsed.openqasm_error === "string"
          ? parsed.openqasm_error
          : undefined;
      const openqasmVersion =
        typeof parsed.openqasm_version === "string"
          ? parsed.openqasm_version
          : undefined;
      const editorOpenqasm =
        typeof parsed.editor_openqasm === "string"
          ? normalizeOpenQasmForEditor(parsed.editor_openqasm)
          : openqasmVersion === "2.0"
            ? normalizeOpenQasmForEditor(openqasm ?? "")
            : undefined;

      return {
        ok: run.ok && Boolean(openqasm),
        durationMs: Date.now() - started,
        framework,
        openqasm: openqasm ?? null,
        openqasmVersion: openqasmVersion ?? null,
        editorOpenqasm: editorOpenqasm ?? null,
        openqasmError: openqasmError ?? null,
        convertedFrameworkCodes: openqasm
          ? createFrameworkConversionCodes({
              sourceFramework: framework,
              openqasm,
              openqasmVersion,
            })
          : {},
        extractionCode: prepared.extractionCode,
        notes: prepared.notes,
        stdout: run.stdout.slice(-4000),
        stderr: run.stderr.slice(-4000),
        fallbackOpenqasm: fallbackOpenqasm ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        framework,
        openqasm: null,
        openqasmVersion: null,
        editorOpenqasm: null,
        openqasmError: err instanceof Error ? err.message : String(err),
        convertedFrameworkCodes: {},
        extractionCode: "",
        notes: ["OpenQASM抽出コードの生成または実行に失敗しました。"],
        stdout: "",
        stderr: "",
      };
    }
  },
  });
}

function createFrameworkConversionCodes({
  sourceFramework,
  openqasm,
  openqasmVersion,
}: {
  sourceFramework: "qiskit" | "pennylane" | "cirq";
  openqasm: string;
  openqasmVersion: string | undefined;
}) {
  const targets = ["qiskit", "pennylane", "cirq"] as const;
  return Object.fromEntries(
    targets
      .filter((target) => target !== sourceFramework)
      .map((target) => [
        target,
        createFrameworkConversionCode({
          target,
          openqasm,
          openqasmVersion,
        }),
      ]),
  );
}

function normalizeOpenQasmForEditor(openqasm: string): string {
  if (!openqasm) return "";
  return openqasm
    .replace(/[αΑ]/g, "alpha")
    .replace(/[βΒ]/g, "beta")
    .replace(/[γΓ]/g, "gamma")
    .replace(/[δΔ]/g, "delta")
    .replace(/[θΘ]/g, "theta")
    .replace(/[λΛ]/g, "lambda")
    .replace(/[μΜ]/g, "mu")
    .replace(/[πΠ]/g, "pi")
    .replace(/[φΦ]/g, "phi")
    .replace(/[ψΨ]/g, "psi")
    .replace(/[ωΩ]/g, "omega")
    .replace(/[^\x00-\x7F]/g, "_");
}

function createFrameworkConversionCode({
  target,
  openqasm,
  openqasmVersion,
}: {
  target: "qiskit" | "pennylane" | "cirq";
  openqasm: string;
  openqasmVersion: string | undefined;
}) {
  const qasmLiteral = JSON.stringify(openqasm);
  const isQasm3 =
    openqasmVersion === "3.0" || openqasm.trimStart().startsWith("OPENQASM 3");

  if (target === "qiskit") {
    return `
from qiskit import qasm2, qasm3
from qiskit_aer import AerSimulator

openqasm = ${qasmLiteral}

qc = ${isQasm3 ? "qasm3.loads(openqasm)" : "qasm2.loads(openqasm)"}

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print({"counts": counts})
`.trim();
  }

  if (target === "pennylane") {
    return `
import re
import pennylane as qml

openqasm = ${qasmLiteral}

def infer_wires(qasm: str) -> int:
    qasm2 = re.search(r"qreg\\s+\\w+\\[(\\d+)\\]", qasm)
    if qasm2:
        return int(qasm2.group(1))
    qasm3 = re.search(r"qubit\\[(\\d+)\\]\\s+\\w+", qasm)
    if qasm3:
        return int(qasm3.group(1))
    return 1

quantum_fn = ${isQasm3 ? "qml.from_qasm3(openqasm)" : "qml.from_qasm(openqasm)"}
n_wires = infer_wires(openqasm)
dev = qml.device("default.qubit", wires=n_wires)

@qml.qnode(dev)
def circuit():
    quantum_fn()
    return qml.probs(wires=range(n_wires))

probs = circuit()
print({"probabilities": probs.tolist(), "wires": n_wires})
`.trim();
  }

  return `
# Requires cirq-core plus the optional parser dependency:
#   pip install ply
import cirq
from cirq.contrib.qasm_import import circuit_from_qasm

openqasm = ${qasmLiteral}

if openqasm.lstrip().startswith("OPENQASM 3"):
    from qiskit import qasm2, qasm3
    openqasm = qasm2.dumps(qasm3.loads(openqasm))

circuit = circuit_from_qasm(openqasm)
simulator = cirq.Simulator()
result = simulator.run(circuit, repetitions=1024)
print({"measurements": {k: v.tolist() for k, v in result.measurements.items()}})
`.trim();
}

function createOpenQasmPostlude(framework: "qiskit" | "pennylane" | "cirq") {
  return `
import json as __namekoq_json

__namekoq_payload = {
    "openqasm": None,
    "openqasm_version": None,
    "editor_openqasm": None,
    "fallback_openqasm": None,
    "openqasm_error": None,
}

try:
    __namekoq_circuit = globals().get("FINAL_CIRCUIT")
    if __namekoq_circuit is None:
        raise ValueError("FINAL_CIRCUIT is not defined")

    if ${JSON.stringify(framework)} == "qiskit":
        from qiskit import QuantumCircuit as __NamekoQQuantumCircuit
        from qiskit import qasm2 as __namekoq_qasm2
        from qiskit import qasm3 as __namekoq_qasm3
        if not isinstance(__namekoq_circuit, __NamekoQQuantumCircuit):
            raise TypeError("FINAL_CIRCUIT must be a qiskit.QuantumCircuit")
        try:
            __namekoq_payload["openqasm"] = __namekoq_qasm2.dumps(__namekoq_circuit)
            __namekoq_payload["openqasm_version"] = "2.0"
            __namekoq_payload["editor_openqasm"] = __namekoq_payload["openqasm"]
        except Exception as __namekoq_qasm2_err:
            __namekoq_payload["editor_openqasm"] = None
            __namekoq_payload["fallback_openqasm"] = __namekoq_qasm3.dumps(__namekoq_circuit)
            __namekoq_payload["openqasm"] = __namekoq_payload["fallback_openqasm"]
            __namekoq_payload["openqasm_version"] = "3.0"
            __namekoq_payload["openqasm_error"] = (
                "OpenQASM 2 export failed; fell back to OpenQASM 3: "
                + type(__namekoq_qasm2_err).__name__ + ": " + str(__namekoq_qasm2_err)
            )

    elif ${JSON.stringify(framework)} == "cirq":
        import cirq as __namekoq_cirq
        if not isinstance(__namekoq_circuit, __namekoq_cirq.Circuit):
            raise TypeError("FINAL_CIRCUIT must be a cirq.Circuit")
        __namekoq_payload["openqasm"] = __namekoq_circuit.to_qasm()
        __namekoq_payload["openqasm_version"] = "2.0"
        __namekoq_payload["editor_openqasm"] = __namekoq_payload["openqasm"]

    elif ${JSON.stringify(framework)} == "pennylane":
        import pennylane as __namekoq_qml
        __namekoq_converter = __namekoq_qml.to_openqasm(__namekoq_circuit)
        __namekoq_payload["openqasm"] = (
            __namekoq_converter()
            if callable(__namekoq_converter)
            else __namekoq_converter
        )
        __namekoq_payload["openqasm_version"] = "2.0"
        __namekoq_payload["editor_openqasm"] = __namekoq_payload["openqasm"]

    else:
        raise ValueError("unsupported framework")

except Exception as __namekoq_err:
    __namekoq_payload["openqasm_error"] = (
        type(__namekoq_err).__name__ + ": " + str(__namekoq_err)
    )

print(__namekoq_json.dumps(__namekoq_payload))
`.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: Request) {
  try {
    const {
      messages,
      modelTier: rawModelTier,
    }: { messages: UIMessage[]; modelTier?: unknown } = await req.json();
    const modelTier = parseModelTier(rawModelTier);
    const modelProfile = resolveModelProfile(modelTier);
    const modelMessages = await convertToModelMessages(messages);

    console.log(
      "[chat] model_tier=%s provider_model=%s",
      modelProfile.tier,
      modelProfile.modelId,
    );

    let stepsUsed = 0;

    const result = streamText({
      model: selectLanguageModel(modelProfile, modelProfile.modelId),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      tools: {
        request_plan: requestPlanTool,
        simulate_qiskit: simulateQiskitTool,
        simulate_pennylane: simulatePennyLaneTool,
        simulate_cirq: simulateCirqTool,
        verify_intent_alignment: createVerifyIntentTool(modelProfile, () => stepsUsed),
        convert_to_openqasm: createConvertToOpenQasmTool(modelProfile),
      },
      stopWhen: stepCountIs(MAX_STEPS),
      onStepFinish: ({ stepNumber, toolCalls, finishReason, usage }) => {
        stepsUsed = stepNumber + 1;
        const toolNames = toolCalls.map((c) => c.toolName).join(",") || "(none)";
        const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
        console.log(
          "[step:%d] tools=[%s] finish=%s tokens=%d",
          stepsUsed,
          toolNames,
          finishReason,
          tokens,
        );
        if (stepsUsed >= MAX_STEPS - 1) {
          console.warn("[chat] approaching step limit: %d/%d", stepsUsed, MAX_STEPS);
        }
      },
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
