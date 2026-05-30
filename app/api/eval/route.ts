import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import {
  MAX_STEPS,
  createAgentTools,
  resolveModelProfile,
  selectLanguageModel,
  type ModelTier,
} from "@/lib/agent-tools";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

export const maxDuration = 300;

const EvalRequestSchema = z.object({
  prompt: z.string().min(1),
  framework: z.enum(["qiskit", "pennylane", "cirq", "auto"]).default("auto"),
  modelTier: z.enum(["default", "pro"]).default("pro"),
});

function buildPrompt(prompt: string, framework: string): string {
  if (framework === "auto") return prompt;
  const label =
    framework === "pennylane" ? "PennyLane" : framework === "cirq" ? "Cirq" : "Qiskit";
  return [
    prompt.trim(),
    "",
    "追加設定:",
    `- フレームワークは ${label} を使う`,
    "- 別フレームワークからの変換ではなく、選択したフレームワークのネイティブコードを生成する",
  ].join("\n");
}

interface StepToolCall {
  toolName: string;
  input: unknown;
}
interface StepToolResult {
  toolName: string;
  output: unknown;
}
interface EvalStep {
  toolCalls: StepToolCall[];
  toolResults?: StepToolResult[];
}

function extractResults(steps: EvalStep[]) {
  let generatedCode: string | null = null;
  let simulationResult: unknown = null;
  let detectedFramework: string | null = null;
  let verificationAligned: boolean | null = null;
  let plan: unknown = null;
  let openqasm: string | null = null;

  for (const step of steps) {
    for (let i = 0; i < (step.toolCalls?.length ?? 0); i++) {
      const call = step.toolCalls[i];
      const out = step.toolResults?.[i]?.output as Record<string, unknown> | undefined;

      if (call.toolName.startsWith("simulate_") && out?.ok === true) {
        generatedCode = ((call.input as Record<string, unknown>).code as string | undefined) ?? null;
        simulationResult = out.parsed ?? null;
        detectedFramework = call.toolName.replace("simulate_", "");
      }

      if (call.toolName === "verify_intent_alignment" && out) {
        verificationAligned = typeof out.aligned === "boolean" ? out.aligned : null;
      }

      if (call.toolName === "request_plan" && out) {
        plan = out.plan ?? null;
      }

      if (call.toolName === "convert_to_openqasm" && out) {
        openqasm = typeof out.openqasm === "string" ? out.openqasm : null;
      }
    }
  }

  return { generatedCode, simulationResult, detectedFramework, verificationAligned, plan, openqasm };
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const body = EvalRequestSchema.parse(await req.json());
    const modelTier: ModelTier = body.modelTier;
    const modelProfile = resolveModelProfile(modelTier);
    const prompt = buildPrompt(body.prompt, body.framework);

    console.log("[eval] framework=%s model_tier=%s", body.framework, modelTier);

    const result = await generateText({
      model: selectLanguageModel(modelProfile, modelProfile.modelId),
      system: SYSTEM_PROMPT,
      prompt,
      tools: createAgentTools(modelProfile, () => 0),
      stopWhen: stepCountIs(MAX_STEPS),
      onStepFinish: ({ stepNumber, toolCalls, finishReason }) => {
        const toolNames = toolCalls.map((c) => c.toolName).join(",") || "(none)";
        console.log(
          "[eval:step:%d] tools=[%s] finish=%s",
          stepNumber + 1,
          toolNames,
          finishReason,
        );
      },
    });

    const extracted = extractResults(result.steps as unknown as EvalStep[]);

    console.log(
      "[eval] ok=%s steps=%d framework=%s",
      Boolean(extracted.generatedCode),
      result.steps.length,
      extracted.detectedFramework,
    );

    return Response.json({
      ok: Boolean(extracted.generatedCode),
      generatedCode: extracted.generatedCode,
      framework: extracted.detectedFramework,
      simulationResult: extracted.simulationResult,
      verificationAligned: extracted.verificationAligned,
      openqasm: extracted.openqasm,
      plan: extracted.plan,
      stepCount: result.steps.length,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    console.error("[eval] error:", err);
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      },
      { status: 500 },
    );
  }
}
