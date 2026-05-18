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
const OPENQASM_MODEL_ID = process.env.NAMEKOQ_OPENQASM_MODEL ?? MODEL_ID;

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
      .describe("対応する simulate tool に渡した実際のコード全文"),
    result: z
      .unknown()
      .describe("対応する simulate tool の parsed 結果 (JSON互換の値)"),
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

const openQasmPreparationSchema = z.object({
  extractionCode: z
    .string()
    .min(1)
    .describe("FINAL_CIRCUIT を定義する、OpenQASM抽出専用のPythonコード"),
  notes: z
    .array(z.string())
    .describe("抽出コードが表現している範囲と制約。なければ空配列"),
});

const openQasmInputSchema = z.object({
  framework: z.enum(["qiskit", "pennylane", "cirq"]),
  generatedCode: z.string().min(1).describe("実行・検証済みの最終Pythonコード"),
  plan: PlanSchema.describe("request_plan で受理された計画"),
  result: z.unknown().describe("simulate tool の parsed 結果"),
});

const convertToOpenQasmTool = tool({
  description: [
    "実行・検証済みの最終コードから OpenQASM を抽出する。",
    "verify_intent_alignment が aligned=true になった後、ユーザーに最終回答する前に呼ぶこと。",
    "このtool内部でLLMが最終コードとは別の OpenQASM 抽出専用 Python コードを作る。",
    "OpenQASM 文字列そのものは LLM が書かず、framework の公式APIで機械的に出力する。",
    "メインの最終コードを OpenQASM 変換しやすい形へ制限してはいけない。",
  ].join("\n"),
  inputSchema: openQasmInputSchema,
  execute: async ({ framework, generatedCode, plan, result }) => {
    const started = Date.now();
    console.log("[convert_to_openqasm] framework=%s", framework);

    try {
      const { experimental_output: prepared } = await generateText({
        model: openai(OPENQASM_MODEL_ID),
        output: Output.object({ schema: openQasmPreparationSchema }),
        system: [
          "あなたは量子コードからOpenQASM抽出用コードを作るエンジニアです。",
          "OpenQASM文字列を直接書いてはいけません。Pythonコードだけを書いてください。",
          "目的は、元の最終コードとは別に、OpenQASMへ機械変換できる回路オブジェクトを FINAL_CIRCUIT として定義することです。",
          "ユーザーの答えを出すための最終コードを単純化・置換するのではなく、実際に使われた主要回路、ansatz、または測定回路を抽出してください。",
          "VQE/QAOAなどで古典最適化・Hamiltonian・後処理がある場合、それらはOpenQASMに含められません。量子回路部分だけを抽出し、その制約をnotesに書いてください。",
          "コードは単体実行可能にし、printやファイルI/Oやpip installは書かないでください。",
          "qiskitなら FINAL_CIRCUIT は qiskit.QuantumCircuit。",
          "cirqなら FINAL_CIRCUIT は cirq.Circuit。",
          "pennylaneなら FINAL_CIRCUIT は引数なしで実行できる qml.QNode にしてください。",
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
          "この最終コードとは別に、OpenQASM抽出専用コードを作ってください。",
          "必ず FINAL_CIRCUIT を定義してください。",
        ].join("\n"),
      });

      const conversionCode =
        prepared.extractionCode.trim() +
        "\n\n" +
        createOpenQasmPostlude(framework);
      const run = await runQiskit(conversionCode);
      const parsed = isRecord(run.parsed) ? run.parsed : {};
      const openqasm =
        typeof parsed.openqasm === "string" ? parsed.openqasm : undefined;
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
          ? parsed.editor_openqasm
          : openqasmVersion === "2.0"
            ? openqasm
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
        __namekoq_payload["openqasm"] = __namekoq_qasm3.dumps(__namekoq_circuit)
        __namekoq_payload["openqasm_version"] = "3.0"
        try:
            __namekoq_payload["editor_openqasm"] = __namekoq_qasm2.dumps(__namekoq_circuit)
        except Exception:
            __namekoq_payload["editor_openqasm"] = None

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
        convert_to_openqasm: convertToOpenQasmTool,
      },
      stopWhen: stepCountIs(12),
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
