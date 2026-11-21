import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBoss, JUDGE_QUEUE } from "@/lib/queue";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/** POST: queue the auto-judge. It needs both answers to be finished. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return unauthorized();
  const { id } = await params;
  const arms = await db.comparisonArm.findMany({ where: { comparisonId: id } });
  if (arms.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (arms.some((a) => a.status !== "completed")) return NextResponse.json({ error: "Both answers must finish first" }, { status: 409 });
  await db.comparisonArm.updateMany({ where: { comparisonId: id }, data: { judge: undefined } });
  await (await getBoss()).send(JUDGE_QUEUE, { comparisonId: id });
  return NextResponse.json({ queued: true }, { status: 202 });
}
