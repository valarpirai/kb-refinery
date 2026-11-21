import { db } from "@/lib/db";
import { pullSource } from "@/lib/ingest/connectors";
import { syncAllSchedules } from "@/lib/ingest/schedule";
import { answerArm, judgeComparison } from "@/lib/chat/answer";
import { indexAll } from "@/lib/chat/indexer";
import { runAgentMessage } from "@/lib/agent/run";
import { reconcileJobs } from "./reconcile";
import { AGENT_QUEUE, ANSWER_QUEUE, getBoss, RECONCILE_QUEUE, INDEX_QUEUE, JUDGE_QUEUE, PULL_QUEUE, REFINE_QUEUE } from "@/lib/queue";
import { processJobItem, type Stage } from "./run-article";
import { WORKER_ID } from "./worker-id";

const BATCH_SIZE = 5;

/** The status an item shows while a worker is on each stage. */
const RUNNING_STATUS = { convert: "converting", analyze: "analyzing", enrich: "enriching", rewrite: "scoring" } as const;

/**
 * Create a job with one item per article and queue each item for processing.
 * @param articleIds articles to refine; omit to refine every article
 * @param scope a short label shown in the UI
 * @param userId who started the job, so they can be notified when it ends
 * @return the created job
 */
export async function createJob(articleIds?: string[], scope?: string, userId?: string | null) {
  const articles = await db.article.findMany({
    where: articleIds ? { id: { in: articleIds } } : undefined,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (articles.length === 0) throw new Error("No articles to refine");

  const job = await db.job.create({
    data: {
      userId: userId ?? null,
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
  await boss.work<{ jobItemId: string; fromStage?: Stage }>(REFINE_QUEUE, async (jobs) => {
    for (const j of jobs) {
      const fromStage = j.data.fromStage ?? "convert";
      // Take the item in one atomic step. If another worker has it, or it is already done,
      // this message is a duplicate and is dropped. That is what makes the job idempotent.
      const claimed = await db.jobItem.updateMany({
        where: { id: j.data.jobItemId, status: "pending" },
        data: { status: RUNNING_STATUS[fromStage], claimedBy: WORKER_ID, heartbeatAt: new Date(), attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      const item = await db.jobItem.findUniqueOrThrow({ where: { id: j.data.jobItemId } });
      await db.job.updateMany({ where: { id: item.jobId, status: { in: ["pending", "completed", "completed_with_errors", "failed"] } }, data: { status: "running", startedAt: new Date(), completedAt: null } });
      await processJobItem(item.id, fromStage);
      await finalizeJobIfDone(item.jobId);
    }
  });
  await boss.work<{ dataSourceId: string }>(PULL_QUEUE, async (jobs) => {
    for (const j of jobs) await pullSource(j.data.dataSourceId);
  });
  await boss.work<{ armId: string }>(ANSWER_QUEUE, async (jobs) => {
    for (const j of jobs) await answerArm(j.data.armId);
  });
  await boss.work<{ comparisonId: string }>(JUDGE_QUEUE, async (jobs) => {
    for (const j of jobs) await judgeComparison(j.data.comparisonId).catch((e) => console.warn("[judge]", e.message));
  });
  await boss.work(INDEX_QUEUE, async () => {
    console.log("[index]", await indexAll());
  });
  await boss.work<{ assistantId: string }>(AGENT_QUEUE, async (jobs) => {
    for (const j of jobs) await runAgentMessage(j.data.assistantId);
  });
  await boss.work(RECONCILE_QUEUE, async () => {
    await reconcileJobs();
  });
  // Every minute is the finest a cron schedule allows. One worker runs each tick.
  await boss.schedule(RECONCILE_QUEUE, "* * * * *", {}, { key: "reconcile" });
  await syncAllSchedules();
  console.log("[worker] listening on", REFINE_QUEUE, "and", PULL_QUEUE);
}
