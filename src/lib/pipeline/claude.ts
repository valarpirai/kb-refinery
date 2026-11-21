import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { stripFence, type LlmResult } from "./ollama";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 64_000);

let client: Anthropic | null = null;

/** One shared client. It reads ANTHROPIC_API_KEY, or a login from `ant auth login`. */
function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 600_000) });
  return client;
}

/**
 * Send one prompt to Claude and parse the reply as JSON matching a schema.
 * The schema is sent as a structured output format, so the reply is valid JSON.
 * The request streams, because long outputs fail on a plain request. Retries once on a parse failure.
 * @param prompt the full user prompt
 * @param schema zod schema the reply must satisfy
 * @param opts.think true for stages that benefit from deeper reasoning; it raises the effort level
 * @return the validated data. Thinking text is not returned by Claude, so it is empty.
 */
export async function chatJsonClaude<T>(prompt: string, schema: z.ZodType<T>, opts: { think?: boolean } = {}): Promise<LlmResult<T>> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await getClient()
      .messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: opts.think ? "high" : "low", format: zodOutputFormat(schema as z.ZodType) },
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage();
    if (message.stop_reason === "refusal") throw new Error(`Claude declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}`);
    if (message.stop_reason === "max_tokens") throw new Error("Claude hit the output limit before finishing. Raise ANTHROPIC_MAX_TOKENS.");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      return { data: schema.parse(JSON.parse(stripFence(text))), thinking: "" };
    } catch (e) {
      lastError = (e as Error).message.slice(0, 300);
    }
  }
  throw new Error(`Model reply did not match the expected shape: ${lastError}`);
}

/**
 * Check that an API key or login is available and the model exists.
 * @return null when ready, otherwise a message describing the problem
 */
export async function checkClaude(): Promise<string | null> {
  try {
    await getClient().models.retrieve(CLAUDE_MODEL);
    return null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return "Claude rejected the credentials. Set ANTHROPIC_API_KEY.";
    if (e instanceof Anthropic.NotFoundError) return `Claude model ${CLAUDE_MODEL} was not found`;
    return `Cannot reach the Claude API: ${(e as Error).message.slice(0, 120)}`;
  }
}
