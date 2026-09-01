import Anthropic from "npm:@anthropic-ai/sdk__ANTHROPIC_SDK_PIN__";

// Model IDs are complete as written — never append a date suffix.
export const MODEL = "claude-opus-5";
// Cheap, fast, good enough for recognition-style vision work where the user
// corrects the result anyway. Haiku supports neither adaptive thinking nor effort.
export const VISION_MODEL = "claude-haiku-4-5";

const isHaiku = (model: string) => model.includes("haiku");

export function anthropicClient(): Anthropic {
  return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
}

/**
 * One structured-output call: returns parsed JSON matching `schema`.
 *
 * Streams under the hood so long generations don't hit HTTP timeouts, and opts
 * into server-side refusal fallbacks — a policy decline is otherwise just a
 * dead turn in front of a paying user. A decline before any output is not billed.
 */
export async function structuredCompletion<T>(opts: {
  system: string;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  model?: string;
}): Promise<T> {
  const client = anthropicClient();
  const model = opts.model ?? MODEL;
  const flagship = !isHaiku(model);

  const stream = client.beta.messages.stream({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    ...(flagship
      ? {
          thinking: { type: "adaptive" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        }
      : {}),
    output_config: {
      ...(flagship ? { effort: opts.effort ?? "high" } : {}),
      format: { type: "json_schema", schema: opts.schema },
    },
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
  });
  const message = await stream.finalMessage();

  // Always check stop_reason before reading content.
  if (message.stop_reason === "refusal") {
    throw new Error("The model declined this request.");
  }
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text block in model response");
  return JSON.parse(text.text) as T;
}
