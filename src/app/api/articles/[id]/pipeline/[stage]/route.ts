import { NextResponse } from "next/server";
import { getStageDetail, type StepKey } from "@/lib/pipeline/stage-detail";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STEPS: StepKey[] = ["import", "convert", "analyze", "enrich", "rewrite", "ready"];

/** GET: what happened to this article in one pipeline stage. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; stage: string }> }) {
  if (!(await getUser())) return unauthorized();
  const { id, stage } = await params;
  if (!STEPS.includes(stage as StepKey)) return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
  const detail = await getStageDetail(id, stage as StepKey);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}
