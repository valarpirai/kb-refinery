import { db } from "@/lib/db";
import { finalizeJobIfDone } from "@/lib/pipeline/jobs";

const IN_PROGRESS = ["converting", "analyzing", "enriching", "scoring"] as const;

export interface DeleteResult {
  deleted: number;
  /** Articles a worker is processing right now. They are left alone. */
  busy: { id: string; title: string }[];
}

/**
 * Delete articles with everything under them: analysis, versions, findings, chunks, tags and stage timings.
 * An article a worker is processing is skipped, so the worker is never left with half its data gone.
 * Queued items for a deleted article vanish with it, and the worker drops their messages.
 * Then it fixes what deleting leaves stale: product article counts, and jobs that were only waiting on these items.
 * @param ids article ids
 * @return how many were deleted and which were skipped
 */
export async function deleteArticles(ids: string[]): Promise<DeleteResult> {
  const busyRows = await db.article.findMany({
    where: { id: { in: ids }, jobItems: { some: { status: { in: [...IN_PROGRESS] } } } },
    select: { id: true, title: true },
  });
  const busyIds = new Set(busyRows.map((b) => b.id));
  const target = ids.filter((id) => !busyIds.has(id));
  if (target.length === 0) return { deleted: 0, busy: busyRows };

  const [products, items] = await Promise.all([
    db.mention.findMany({ where: { analysis: { articleId: { in: target } } }, select: { productId: true }, distinct: ["productId"] }),
    db.jobItem.findMany({ where: { articleId: { in: target } }, select: { jobId: true }, distinct: ["jobId"] }),
  ]);

  const { count } = await db.article.deleteMany({ where: { id: { in: target } } });

  for (const { productId } of products) {
    await db.product.update({ where: { id: productId }, data: { articleCount: await db.mention.count({ where: { productId } }) } });
  }
  for (const { jobId } of items) await finalizeJobIfDone(jobId);
  return { deleted: count, busy: busyRows };
}
