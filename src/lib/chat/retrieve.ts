import { db } from "@/lib/db";
import { toVectorLiteral } from "./embed";

const TOP_K = 5;
/** How many candidates each search contributes before they are merged. */
const POOL = 20;
/** Reciprocal rank fusion constant. A larger value flattens the gap between ranks. */
const RRF_K = 60;

/** Chunks scoring below this are treated as unrelated. Relevant hits score about 0.75 to 0.85 with nomic-embed-text. */
export const MIN_SCORE = 0.6;

export interface Source {
  n: number;
  articleId: string;
  analysisId: string | null;
  title: string;
  heading: string | null;
  score: number;
  excerpt: string;
}

interface Row {
  id: string;
  articleId: string;
  analysisId: string | null;
  title: string;
  heading: string | null;
  content: string;
  score: number;
}

/**
 * Turn a question into a Postgres tsquery that needs every word to match.
 * Words shorter than three characters are dropped. Stop words are removed by the english config.
 * @param question the user's question
 * @return a query like "vpn & password", or an empty string when no usable word is left
 */
export function keywordQuery(question: string): string {
  const words = question.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
  return [...new Set(words)].slice(0, 12).join(" & ");
}

/**
 * Find the chunks that best answer a question within one variant.
 * Runs a vector search and a keyword search, then merges both ranked lists by reciprocal rank fusion.
 * A vector hit must reach minScore. A chunk that holds every word of the question always qualifies,
 * which catches exact terms such as error codes that embeddings miss.
 * @param variant original or refined
 * @param vector the question embedding
 * @param question the question text, for the keyword search
 * @param minScore drop vector hits scoring below this; defaults to keeping all
 * @return up to five sources, best first, numbered from 1. Score is the cosine similarity.
 */
export async function retrieve(variant: "original" | "refined", vector: number[], question: string, minScore = 0): Promise<Source[]> {
  const lit = toVectorLiteral(vector);
  const byVector = await db.$queryRaw<Row[]>`
    SELECT c.id, c."articleId", an.id AS "analysisId", a.title, c.heading, c.content, 1 - (c.embedding <=> ${lit}::vector) AS score
    FROM "Chunk" c JOIN "Article" a ON a.id = c."articleId"
    JOIN "Analysis" an ON an."articleId" = a.id
    WHERE an."pipelineStage" = 'ready' AND c.variant = ${variant}::"ChunkVariant" AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${lit}::vector
    LIMIT ${POOL}`;

  const q = keywordQuery(question);
  const byKeyword = q
    ? await db.$queryRaw<Row[]>`
        SELECT c.id, c."articleId", an.id AS "analysisId", a.title, c.heading, c.content, 1 - (c.embedding <=> ${lit}::vector) AS score
        FROM "Chunk" c JOIN "Article" a ON a.id = c."articleId"
        JOIN "Analysis" an ON an."articleId" = a.id
        WHERE an."pipelineStage" = 'ready' AND c.variant = ${variant}::"ChunkVariant" AND c.embedding IS NOT NULL
          AND to_tsvector('english', c.content) @@ to_tsquery('english', ${q})
        ORDER BY ts_rank_cd(to_tsvector('english', c.content), to_tsquery('english', ${q})) DESC
        LIMIT ${POOL}`
    : [];

  const merged = new Map<string, { row: Row; rrf: number }>();
  const add = (rows: Row[], keep: (r: Row) => boolean) =>
    rows.forEach((row, rank) => {
      if (!keep(row)) return;
      const hit = merged.get(row.id) ?? { row, rrf: 0 };
      hit.rrf += 1 / (RRF_K + rank + 1);
      merged.set(row.id, hit);
    });
  add(byVector, (r) => Number(r.score) >= minScore);
  add(byKeyword, () => true);

  return [...merged.values()]
    .sort((x, y) => y.rrf - x.rrf)
    .slice(0, TOP_K)
    .map(({ row: r }, i) => ({ n: i + 1, articleId: r.articleId, analysisId: r.analysisId, title: r.title, heading: r.heading, score: Number(r.score), excerpt: r.content }));
}
