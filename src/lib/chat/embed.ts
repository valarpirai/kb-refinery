const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

/**
 * Embed texts with Ollama. nomic-embed-text expects a task prefix.
 * @param texts the strings to embed
 * @param kind "document" for stored chunks, "query" for a user question
 * @return one 768-number vector per input, in order
 */
export async function embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => `search_${kind}: ${t}`) }),
  });
  if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { embeddings?: number[][] };
  if (!body.embeddings || body.embeddings.length !== texts.length) throw new Error("Embedding response had the wrong shape");
  return body.embeddings;
}

/**
 * Format a vector as a pgvector literal.
 * @param v the numbers
 * @return text like [0.1,0.2] for a ::vector cast
 */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
