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
import { runQiskit } from "@/lib/run-qiskit";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { CRITIC_PROMPT } from "@/lib/critic-prompt";
import { PlanSchema } from "@/lib/plan-schema";

export const maxDuration = 300;

const MAX_STEPS = 16;

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
      "DEEPSEEK_API_KEY is required when using Default / DeepSeek V4 Pro.",
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
      "Return only one valid JSON object that matches the requested schema.",
      "Do not wrap the JSON in markdown fences. Do not include commentary.",
    ].join("\n"),
    prompt: [
      prompt,
      "",
      "JSON schema shape reminder:",
      schemaDescription(schema),
      "",
      "Return only valid JSON.",
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
    throw new Error("Model did not return a parseable JSON object.");
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
    "Submit a structured quantum execution plan from the user request.",
    "This must be called first before simulate_qiskit / simulate_pennylane / simulate_cirq.",
    "The Zod schema checks types, enums, units, and ranges. If validation fails, correct the tool call and submit again.",
    "Semantic validity is checked later by verify_intent_alignment.",
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
      next: "Plan accepted. Write Python code for the selected framework according to this plan, then call the matching simulation tool.",
    };
  },
});

const simulationInputSchema = z.object({
  code: z.string().min(1).describe("Full Python code to execute"),
  purpose: z
    .string()
    .describe("Briefly state what this simulation is meant to verify"),
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
      "The code must print a JSON-compatible dict as the final stdout line.",
      "Example: print({'counts': {'00': 512, '11': 512}, 'shots': 1024})",
      "Do not pass code for another framework or converted wrapper code into this tool.",
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
  simulator: "Aer qasm / statevector / density matrix / MPS / qiskit-aer primitives",
  codeRule:
    "Pass only Qiskit + qiskit-aer code. Use AerSimulator(), AerSimulator(method='statevector'), AerSimulator(method='density_matrix'), AerSimulator(method='matrix_product_state'), EstimatorV2, SamplerV2, etc.",
});

const simulatePennyLaneTool = createSimulationTool({
  name: "simulate_pennylane",
  framework: "pennylane",
  simulator: "default.qubit / default.mixed / lightning.qubit",
  codeRule:
    "Pass only PennyLane code. Use qml.device('default.qubit' / 'default.mixed' / 'lightning.qubit') and @qml.qnode.",
});

const simulateCirqTool = createSimulationTool({
  name: "simulate_cirq",
  framework: "cirq",
  simulator: "cirq.Simulator / DensityMatrixSimulator / CliffordSimulator",
  codeRule:
    "Pass only Cirq code. Use cirq.Circuit, cirq.LineQubit, cirq.Simulator / cirq.DensityMatrixSimulator / cirq.CliffordSimulator. Use CliffordSimulator only for Clifford circuits.",
});

const verdictSchema = z.object({
  aligned: z
    .boolean()
    .describe("Whether the user request, generated code, and result are aligned in algorithm, parameters, and outputs"),
  confidence: z.enum(["high", "medium", "low"]).describe("Confidence in the verdict"),
  mismatches: z
    .array(
      z.object({
        aspect: z
          .string()
          .describe("Mismatch aspect, e.g. bond_length, n_assets, algorithm_choice"),
        expected: z.string().describe("What the user likely intended"),
        actual: z.string().describe("What the code/result actually did"),
      }),
    )
    .default([])
    .describe("Concrete mismatches. Include minor mismatches even when aligned=true if useful. Use [] when there are none."),
  suggestions: z
    .array(z.string())
    .default([])
    .describe("Fix suggestions when aligned=false. Use an empty array when aligned=true"),
  summary: z.string().describe("A 1-2 sentence summary in English"),
});

function createVerifyIntentTool(profile: ModelProfile, getStepsUsed: () => number) {
  return tool({
  description: [
    "Ask an independent critic LLM to judge whether the generated code/result matches the user request.",
    "After the matching simulation tool returns ok=true, call this before the final answer.",
    "If aligned=false, revise the code using the suggestions, simulate again, and verify again.",
    "If aligned=true, call convert_to_openqasm next.",
  ].join("\n"),
  inputSchema: z.object({
    userRequest: z
      .string()
      .describe("Copy the user's original request exactly"),
    interpretation: z
      .string()
      .describe("Explain your interpretation of the request in 1-2 sentences"),
    plan: PlanSchema.describe(
      "Pass the exact plan object accepted by request_plan",
    ),
    generatedCode: z
      .string()
      .describe("The exact full code passed to the matching simulation tool"),
    result: z
      .unknown()
      .describe("The parsed result from the matching simulation tool"),
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
          "## Original user request",
          userRequest,
          "",
          "## Agent interpretation",
          interpretation,
          "",
          "## Structured plan accepted by request_plan",
          "```json",
          JSON.stringify(plan, null, 2),
          "```",
          "",
          "## Generated and executed code",
          "```python",
          generatedCode,
          "```",
          "",
          "## Execution result (parsed)",
          "```json",
          JSON.stringify(result, null, 2),
          "```",
          "",
          "Judge alignment from these three perspectives:",
          "1. userRequest vs plan alignment (interpretation errors)",
          "2. plan vs generatedCode alignment (implementation errors)",
          "3. whether result satisfies plan.success_criteria (result validity)",
        ].join("\n"),
      });
      const stepsUsed = getStepsUsed();
      const stepsRemaining = MAX_STEPS - stepsUsed;
      console.log(
        "[verify_intent] aligned=%s confidence=%s mismatches=%d steps_used=%d",
        verdict.aligned,
        verdict.confidence,
        (verdict.mismatches ?? []).length,
        stepsUsed,
      );

      const next = verdict.aligned
        ? "aligned=true. Call convert_to_openqasm next, then give the final answer."
        : stepsRemaining >= 3
          ? `aligned=false. You MUST fix the code based on suggestions and call the simulation tool again, then verify again. Steps remaining: ${stepsRemaining}.`
          : `aligned=false but only ${stepsRemaining} steps remain. Apply the most critical fix only, then proceed to convert_to_openqasm and give the final answer with caveats.`;

      return {
        ...verdict,
        next,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      console.error("[verify_intent] critic error:", err);
      return {
        aligned: false,
        confidence: "low" as const,
        mismatches: [],
        suggestions: [
          `Critic call failed: ${err instanceof Error ? err.message : String(err)}. Proceed without validation or retry.`,
        ],
        summary: "The critic LLM call failed.",
        next: "Critic call failed. Proceed to convert_to_openqasm and give the final answer.",
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
    .describe("Python code dedicated to OpenQASM extraction that defines FINAL_CIRCUIT"),
  notes: z
    .array(z.string())
    .describe("Scope and limitations represented by the extraction code. Empty array if none"),
});

const openQasmInputSchema = z.object({
  framework: z.enum(["qiskit", "pennylane", "cirq"]),
  generatedCode: z.string().min(1).describe("Final executed and verified Python code"),
  plan: PlanSchema.describe("Plan accepted by request_plan"),
  result: z.unknown().describe("Parsed result from the simulation tool"),
});

function createConvertToOpenQasmTool(profile: ModelProfile) {
  return tool({
  description: [
    "Extract OpenQASM from the final executed and verified code.",
    "Call this after verify_intent_alignment returns aligned=true and before the final answer.",
    "Inside this tool, an LLM creates separate Python code dedicated to OpenQASM extraction.",
    "The LLM must not write the OpenQASM string directly; official framework APIs produce it mechanically.",
    "Do not simplify the main final code just to make OpenQASM conversion easier.",
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
          "You are an engineer who writes OpenQASM extraction code from quantum programs.",
          "Do not write the OpenQASM string directly. Write only Python code.",
          "The goal is to define a circuit object named FINAL_CIRCUIT that can be mechanically converted to OpenQASM, separate from the original final code.",
          "Do not simplify or replace the final code used to answer the user. Extract the main circuit, ansatz, or measurement circuit actually used.",
          "For VQE/QAOA and similar workflows, classical optimization, Hamiltonians, and post-processing cannot be fully represented in OpenQASM. Extract only the quantum circuit portion and document limitations in notes.",
          "The code must be standalone and must not print, use file I/O, or run pip install.",
          "For Qiskit, FINAL_CIRCUIT must be a qiskit.QuantumCircuit.",
          "For Cirq, FINAL_CIRCUIT must be a cirq.Circuit.",
          "For PennyLane, FINAL_CIRCUIT must be a zero-argument qml.QNode.",
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
          "Create OpenQASM extraction code separate from this final code.",
          "You must define FINAL_CIRCUIT.",
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
        notes: ["OpenQASM extraction code generation or execution failed."],
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
