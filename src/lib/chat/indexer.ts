import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { chunkArticle } from "./chunker";
import { embed, toVectorLiteral } from "./embed";

const EMBED_BATCH = 16;

/**
 * Pick the text for each variant of one article.
 * Original is the raw content as imported. Refined is the rewritten article,
 * or the converted Markdown when the pipeline found nothing to rewrite.
 * @param articleId the article
 * @return both texts, or null when the article has not been analyzed
 */
async function variantTexts(articleId: string) {
  const analysis = await db.analysis.findUnique({ where: { articleId }, include: { article: true } });
  if (!analysis || analysis.pipelineStage !== "ready") return null;
  const latest = await db.snapshot.findFirst({ where: { analysisId: analysis.id }, orderBy: { version: "desc" }, select: { version: true } });
  if (!latest) return null;
  const snaps = await db.snapshot.findMany({ where: { analysisId: analysis.id, version: latest.version } });
  const get = (t: string) => snaps.find((s) => s.type === t)?.content;
  const refined = get("enriched") ?? get("converted");
  if (!refined) return null;
  return { title: analysis.article.title, original: get("raw") ?? analysis.article.body, refined };
}

/**
 * Rebuild the chunks and embeddings for one article, both variants.
 * Skipped silently when the article has not finished the pipeline.
 * @param articleId the article to index
 * @return number of chunks written
 */
export async function indexArticle(articleId: string): Promise<number> {
  const texts = await variantTexts(articleId);
  if (!texts) return 0;
  const plan = (["original", "refined"] as const).flatMap((variant) =>
    chunkArticle(texts.title, texts[variant]).map((c, ord) => ({ variant, ord, ...c })),
  );

  const vectors: number[][] = [];
  for (let i = 0; i < plan.length; i += EMBED_BATCH) {
    vectors.push(...(await embed(plan.slice(i, i + EMBED_BATCH).map((p) => p.content), "document")));
  }

  await db.$transaction(async (tx) => {
    await tx.chunk.deleteMany({ where: { articleId } });
    for (const [i, p] of plan.entries()) {
      await tx.$executeRaw`
        INSERT INTO "Chunk" (id, "articleId", variant, ord, heading, content, embedding)
        VALUES (${randomUUID()}, ${articleId}, ${p.variant}::"ChunkVariant", ${p.ord}, ${p.heading}, ${p.content}, ${toVectorLiteral(vectors[i])}::vector)`;
    }
  });
  return plan.length;
}

/** Re-index every article that has finished the pipeline. One failure does not stop the rest. */
export async function indexAll(): Promise<{ indexed: number; chunks: number; failed: number }> {
  const analyses = await db.analysis.findMany({ where: { pipelineStage: "ready" }, select: { articleId: true } });
  let indexed = 0, chunks = 0, failed = 0;
  for (const a of analyses) {
    try {
      const n = await indexArticle(a.articleId);
      if (n > 0) { indexed++; chunks += n; }
    } catch (e) {
      failed++;
      console.warn(`[index] ${a.articleId}: ${(e as Error).message}`);
    }
  }
  return { indexed, chunks, failed };
}
