import { db } from "@/lib/db";
import { getBoss, REFINE_QUEUE } from "@/lib/queue";
import { STAGES, type Stage } from "./run-article";

export type RestartResult = { ok: true; fromStage: Stage } | { ok: false; status: 404 | 409 | 400; error: string };

/**
 * Run a failed article again. Starts at the stage that failed, or an earlier stage.
 * Later stages need the earlier ones' results, so it cannot skip ahead.
 * @param itemId the failed job item
 * @param fromStage optional earlier stage to start from
 * @return the stage it will resume from, or why it was refused
 */
export async function restartJobItem(itemId: string, fromStage?: Stage): Promise<RestartResult> {
  const item = await db.jobItem.findUnique({ where: { id: itemId } });
  if (!item) return { ok: false, status: 404, error: "Not found" };
  if (item.status !== "failed") return { ok: false, status: 409, error: "Only a failed article can be restarted" };

  const failedAt = STAGES.indexOf((item.failedStage as Stage | null) ?? "convert");
  const from = fromStage ?? STAGES[failedAt];
  if (STAGES.indexOf(from) > failedAt) return { ok: false, status: 400, error: `It failed at ${STAGES[failedAt]}. Restart from there or earlier.` };

  // failedStage doubles as "resume point" while the item waits, so the pipeline view can show where it will pick up.
  await db.jobItem.update({ where: { id: itemId }, data: { status: "pending", message: null, failedStage: from, restarts: { increment: 1 } } });
  await db.job.update({ where: { id: item.jobId }, data: { status: "running", completedAt: null } });
  // Priority 10 puts a restart ahead of the normal backlog.
  await (await getBoss()).send(REFINE_QUEUE, { jobItemId: itemId, fromStage: from }, { priority: 10 });
  return { ok: true, fromStage: from };
}
