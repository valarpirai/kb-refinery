import { NextResponse } from "next/server";
import { ownedComparison } from "@/lib/chat/access";
import { getBoss, JUDGE_QUEUE } from "@/lib/queue";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/** POST: queue the auto-judge. It needs both answers to be finished. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const owned = await ownedComparison(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const arms = owned.arms;
  if (arms.some((a) => a.status !== "completed")) return NextResponse.json({ error: "Both answers must finish first" }, { status: 409 });
  await (await getBoss()).send(JUDGE_QUEUE, { comparisonId: id });
  return NextResponse.json({ queued: true }, { status: 202 });
}
