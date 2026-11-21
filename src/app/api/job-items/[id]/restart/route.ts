import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { STAGES } from "@/lib/pipeline/run-article";
import { getBoss, REFINE_QUEUE } from "@/lib/queue";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ fromStage: z.enum(STAGES).optional() });

/**
 * POST: run a failed article again. Starts at the stage that failed, or an earlier
 * stage you choose. Later stages need the earlier ones' results, so you cannot skip ahead.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return unauthorized();
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "fromStage must be convert, analyze, enrich or rewrite" }, { status: 400 });

  const item = await db.jobItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.status !== "failed") return NextResponse.json({ error: "Only a failed article can be restarted" }, { status: 409 });

  const failedAt = STAGES.indexOf((item.failedStage as (typeof STAGES)[number] | null) ?? "convert");
  const from = parsed.data.fromStage ?? STAGES[failedAt];
  if (STAGES.indexOf(from) > failedAt) {
    return NextResponse.json({ error: `It failed at ${STAGES[failedAt]}. Restart from there or earlier.` }, { status: 400 });
  }

  // failedStage doubles as "resume point" while the item waits, so the pipeline view can show where it will pick up.
  await db.jobItem.update({ where: { id }, data: { status: "pending", message: null, failedStage: from, restarts: { increment: 1 } } });
  await db.job.update({ where: { id: item.jobId }, data: { status: "running", completedAt: null } });
  // Priority 10 puts a restart ahead of the normal backlog.
  await (await getBoss()).send(REFINE_QUEUE, { jobItemId: id, fromStage: from }, { priority: 10 });
  return NextResponse.json({ queued: true, fromStage: from }, { status: 202 });
}
