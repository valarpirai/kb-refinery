import { z } from "zod";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:4b-thinking-2507-q4_K_M";
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 16384);
const THINK_MODE = process.env.OLLAMA_THINK ?? "auto"; // auto | always | never
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 600_000);

export interface LlmResult<T> {
  data: T;
  thinking: string;
}

/**
 * Remove a Markdown code fence around a JSON reply, if present.
 * @param text raw model output
 * @return the text with any surrounding fence removed
 */
export function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Read a streamed Ollama chat reply and join its pieces.
 * Streaming matters: Node's fetch gives up if no response headers arrive within 300 seconds,
 * and a long rewrite on a small model takes longer than that. A stream sends headers at once.
 * @param res the response of a chat request made with stream true
 * @return the full content and thinking text
 */
async function readStream(res: Response): Promise<{ content: string; thinking: string }> {
  let content = "";
  let thinking = "";
  let buffer = "";
  const take = (line: string) => {
    if (!line.trim()) return;
    const part = JSON.parse(line) as { message?: { content?: string; thinking?: string }; error?: string };
    if (part.error) throw new Error(`Ollama: ${part.error.slice(0, 300)}`);
    content += part.message?.content ?? "";
    thinking += part.message?.thinking ?? "";
  };
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(take);
  }
  take(buffer);
  return { content, thinking };
}

/**
 * Send one prompt to Ollama and parse the reply as JSON matching a schema.
 * The schema is also sent as Ollama's structured-output format, which
 * constrains the model to valid JSON. Retries once on a parse or validation
 * failure.
 * @param prompt the full user prompt
 * @param schema zod schema the reply must satisfy
 * @param opts.think whether this stage benefits from reasoning (default false). The
 *   OLLAMA_THINK env var can force it on ("always") or off ("never").
 * @return the validated data and the model's reasoning text
 */
export async function chatJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: { think?: boolean } = {},
): Promise<LlmResult<T>> {
  const format = z.toJSONSchema(schema, { io: "input" });
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        think: THINK_MODE === "always" ? true : THINK_MODE === "never" ? false : (opts.think ?? false),
        format,
        options: { num_ctx: NUM_CTX, temperature: 0.2 },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { content, thinking } = await readStream(res);
    try {
      const data = schema.parse(JSON.parse(stripFence(content)));
      return { data, thinking };
    } catch (e) {
      lastError = (e as Error).message.slice(0, 300);
    }
  }
  throw new Error(`Model reply did not match the expected shape: ${lastError}`);
}

/**
 * Check that Ollama is reachable and the configured model is installed.
 * @return null when ready, otherwise a message describing the problem
 */
export async function checkOllama(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const tags = (await res.json()) as { models?: { name: string }[] };
    return tags.models?.some((m) => m.name === MODEL) ? null : `Model ${MODEL} is not installed in Ollama`;
  } catch {
    return `Cannot reach Ollama at ${BASE_URL}`;
  }
}
