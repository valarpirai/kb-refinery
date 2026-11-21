import { db } from "@/lib/db";
import { getBoss, REFINE_QUEUE } from "@/lib/queue";
import { processJobItem } from "./run-article";

const BATCH_SIZE = 5;

/**
 * Create a job with one item per article and queue each item for processing.
 * @param articleIds articles to refine; omit to refine every article
 * @param scope a short label shown in the UI
 * @return the created job
 */
export async function createJob(articleIds?: string[], scope?: string) {
  const articles = await db.article.findMany({
    where: articleIds ? { id: { in: articleIds } } : undefined,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (articles.length === 0) throw new Error("No articles to refine");

  const job = await db.job.create({
    data: {
      status: "pending",
      articlesTotal: articles.length,
      remainingBatches: Math.ceil(articles.length / BATCH_SIZE),
      scope: scope ?? (articleIds ? `${articles.length} selected article(s)` : "All articles"),
      items: { create: articles.map((a, i) => ({ articleId: a.id, batchNumber: Math.floor(i / BATCH_SIZE) })) },
    },
    include: { items: true },
  });
  const boss = await getBoss();
  for (const item of job.items) await boss.send(REFINE_QUEUE, { jobItemId: item.id });
  return job;
}

/**
 * Set the job's final status once every item has finished.
 * All completed or skipped is completed; a mix with failures is
 * completed_with_errors; all failed is failed.
 * @param jobId the job to check
 */
export async function finalizeJobIfDone(jobId: string): Promise<void> {
  const items = await db.jobItem.findMany({ where: { jobId }, select: { status: true } });
  const open = items.some((i) => ["pending", "converting", "analyzing", "enriching", "scoring"].includes(i.status));
  if (open) return;
  const failed = items.filter((i) => i.status === "failed").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  await db.job.update({
    where: { id: jobId },
    data: {
      completedAt: new Date(),
      remainingBatches: 0,
      articlesSkipped: skipped,
      articlesProcessed: items.length - skipped - failed,
      status: failed === 0 ? "completed" : failed === items.length ? "failed" : "completed_with_errors",
    },
  });
}

/** Start consuming the refine queue. One article at a time, since the local model is the bottleneck. */
export async function startWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<{ jobItemId: string }>(REFINE_QUEUE, async (jobs) => {
    for (const j of jobs) {
      const item = await db.jobItem.findUnique({ where: { id: j.data.jobItemId } });
      if (!item) continue;
      await db.job.updateMany({ where: { id: item.jobId, status: "pending" }, data: { status: "running", startedAt: new Date() } });
      await processJobItem(item.id);
      await finalizeJobIfDone(item.jobId);
    }
  });
  console.log("[worker] listening on", REFINE_QUEUE);
}
