import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { stripFence, type LlmResult } from "./ollama";

export const BEDROCK_MODEL = process.env.BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const MAX_TOKENS = Number(process.env.BEDROCK_MAX_TOKENS ?? 16_000);

let client: BedrockRuntimeClient | null = null;

/**
 * One shared client. The AWS SDK reads AWS_BEARER_TOKEN_BEDROCK, or the usual AWS credential chain.
 * @return the shared Bedrock runtime client
 */
function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    requestHandler: { requestTimeout: Number(process.env.BEDROCK_TIMEOUT_MS ?? 600_000) },
  });
  return client;
}

/**
 * Send one prompt to Claude on Amazon Bedrock and parse the reply as JSON matching a schema.
 * Sonnet 4.5 has no structured output mode on Bedrock, so the schema goes in the prompt
 * and the reply is checked with zod. Retries once on a parse failure.
 * @param prompt the full user prompt
 * @param schema zod schema the reply must satisfy
 * @param opts.think accepted for parity with other providers; Bedrock stages run without extended thinking
 * @return the validated data. Thinking text is not returned, so it is empty.
 */
export async function chatJsonBedrock<T>(prompt: string, schema: z.ZodType<T>, opts: { think?: boolean } = {}): Promise<LlmResult<T>> {
  void opts;
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema as z.ZodType));
  const system = `Reply with one JSON object and nothing else. No code fence. It must match this JSON Schema:\n${jsonSchema}`;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await getClient().send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL,
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0 },
      }),
    );
    if (res.stopReason === "max_tokens") throw new Error("Claude hit the output limit before finishing. Raise BEDROCK_MAX_TOKENS.");
    if (res.stopReason === "guardrail_intervened" || res.stopReason === "content_filtered") throw new Error(`Bedrock blocked this request (${res.stopReason})`);
    const text = (res.output?.message?.content ?? []).flatMap((b) => (b.text ? [b.text] : [])).join("");
    try {
      return { data: schema.parse(JSON.parse(stripFence(text))), thinking: "" };
    } catch (e) {
      lastError = (e as Error).message.slice(0, 300);
    }
  }
  throw new Error(`Model reply did not match the expected shape: ${lastError}`);
}

/**
 * Check that Bedrock accepts the credentials and the model answers.
 * Sends a one-token request, because the runtime API cannot list models.
 * @return null when ready, otherwise a message describing the problem
 */
export async function checkBedrock(): Promise<string | null> {
  try {
    await getClient().send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL,
        messages: [{ role: "user", content: [{ text: "ping" }] }],
        inferenceConfig: { maxTokens: 1 },
      }),
    );
    return null;
  } catch (e) {
    const name = (e as Error).name;
    if (name === "AccessDeniedException" || name === "UnrecognizedClientException" || name === "ExpiredTokenException") return "Bedrock rejected the credentials. Set AWS_BEARER_TOKEN_BEDROCK and AWS_REGION.";
    if (name === "ResourceNotFoundException" || name === "ValidationException") return `Bedrock model ${BEDROCK_MODEL} was not found or is not enabled`;
    return `Cannot reach Bedrock: ${(e as Error).message.slice(0, 120)}`;
  }
}
