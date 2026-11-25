import type { z } from "zod";
import { checkBedrock, chatJsonBedrock } from "./bedrock";
import { checkClaude, chatJsonClaude } from "./claude";
import { checkOllama, chatJson as chatJsonOllama, type LlmResult } from "./ollama";

/** Which model service answers: "ollama" (default, local), "anthropic" (Claude API) or "bedrock" (Claude on Amazon Bedrock). */
export const LLM_PROVIDER: "ollama" | "anthropic" | "bedrock" =
  process.env.LLM_PROVIDER === "anthropic" ? "anthropic" : process.env.LLM_PROVIDER === "bedrock" ? "bedrock" : "ollama";

/**
 * Send one prompt to the configured model and parse the reply as JSON matching a schema.
 * @param prompt the full user prompt
 * @param schema zod schema the reply must satisfy
 * @param opts.think whether this stage benefits from reasoning
 * @return the validated data and any reasoning text
 */
export function chatJson<T>(prompt: string, schema: z.ZodType<T>, opts: { think?: boolean } = {}): Promise<LlmResult<T>> {
  if (LLM_PROVIDER === "bedrock") return chatJsonBedrock(prompt, schema, opts);
  return LLM_PROVIDER === "anthropic" ? chatJsonClaude(prompt, schema, opts) : chatJsonOllama(prompt, schema, opts);
}

/**
 * Check that the configured model service is ready.
 * @return null when ready, otherwise a message describing the problem
 */
export function checkLlm(): Promise<string | null> {
  if (LLM_PROVIDER === "bedrock") return checkBedrock();
  return LLM_PROVIDER === "anthropic" ? checkClaude() : checkOllama();
}
