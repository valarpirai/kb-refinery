import { db } from "@/lib/db";
import { notify } from "@/lib/notify";
import { getBoss, REFINE_QUEUE } from "@/lib/queue";
import { finalizeJobIfDone } from "./jobs";
import type { Stage } from "./run-article";
import { HEARTBEAT_TIMEOUT_MS, MAX_ATTEMPTS } from "./worker-id";

const RUNNING = ["converting", "analyzing", "enriching", "scoring"] as const;
const STAGE_OF: Record<(typeof RUNNING)[number], Stage> = { converting: "convert", analyzing: "analyze", enriching: "enrich", scoring: "rewrite" };
/** A pending item untouched this long may have lost its queue message. */
const STALE_PENDING_MS = 60 * 60 * 1000;

export interface ReconcileSummary {
  recovered: number;
  failed: number;
  requeued: number;
}

/**
 * Find items whose worker went silent and put them back in play.
 *
 * Safe to run at any time and from several places at once: every change is a
 * conditional update, so only one run wins an item. An item whose heartbeat
 * stopped goes back to pending at the stage it was on, and a fresh queue
 * message is sent. After MAX_ATTEMPTS claims it is marked failed instead.
 * Nothing here repeats work: the worker's claim check and the stages'
 * re-run safety make a duplicate message harmless.
 * @return how many items were recovered, failed or re-queued
 */
export async function reconcileJobs(): Promise<ReconcileSummary> {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  const summary: ReconcileSummary = { recovered: 0, failed: 0, requeued: 0 };
  const boss = await getBoss();

  const stale = await db.jobItem.findMany({
    where: {
      status: { in: [...RUNNING] },
      OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, updatedAt: { lt: cutoff } }],
    },
  });

  for (const item of stale) {
    const stage = STAGE_OF[item.status as (typeof RUNNING)[number]];
    // Match on what we read, so a worker that just woke up and sent a heartbeat is left alone.
    const unchanged = { id: item.id, status: item.status, updatedAt: item.updatedAt, OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null }] };

    if (item.attempts >= MAX_ATTEMPTS) {
      const won = await db.jobItem.updateMany({
        where: unchanged,
        data: { status: "failed", failedStage: stage, claimedBy: null, message: `The worker stopped responding ${item.attempts} times while at the ${stage} stage. Restart it to try again.` },
      });
      if (won.count === 1) {
        summary.failed++;
        if (item.analysisId) await db.analysis.update({ where: { id: item.analysisId }, data: { pipelineStage: "failed" } });
        await finalizeJobIfDone(item.jobId);
        const owner = (await db.job.findUnique({ where: { id: item.jobId }, select: { userId: true } }))?.userId;
        await notify(owner, { level: "error", title: "An article stopped responding", body: `It was stuck at the ${stage} stage ${item.attempts} times. Open the job to restart it.`, href: `/jobs/${item.jobId}` });
      }
      continue;
    }

    const won = await db.jobItem.updateMany({
      where: unchanged,
      // failedStage doubles as the resume point while the item waits.
      data: { status: "pending", failedStage: stage, claimedBy: null, message: "Recovered after the worker stopped responding" },
    });
    if (won.count === 1) {
      await boss.send(REFINE_QUEUE, { jobItemId: item.id, fromStage: stage }, { priority: 5 });
      summary.recovered++;
    }
  }

  // Pending for a long time with no recent change: the queue message may be gone. Send another.
  // A duplicate is harmless because the worker only runs an item it can claim.
  const lost = await db.jobItem.findMany({ where: { status: "pending", updatedAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } }, take: 50 });
  for (const item of lost) {
    await boss.send(REFINE_QUEUE, { jobItemId: item.id, fromStage: (item.failedStage as Stage | null) ?? "convert" });
    await db.jobItem.update({ where: { id: item.id }, data: { updatedAt: new Date() } });
    summary.requeued++;
  }

  if (summary.recovered || summary.failed || summary.requeued) console.log("[reconcile]", summary);
  return summary;
}
