import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import {
  MAX_STEPS,
  createAgentTools,
  resolveModelProfile,
  selectLanguageModel,
  type ModelTier,
} from "@/lib/agent-tools";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

export const maxDuration = 300;

function parseModelTier(value: unknown): ModelTier {
  return value === "pro" ? "pro" : "default";
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
      tools: createAgentTools(modelProfile, () => stepsUsed),
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
