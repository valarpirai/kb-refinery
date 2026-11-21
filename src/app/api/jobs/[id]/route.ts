import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: one job with its per-article items. Polled by the job page for live progress. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return unauthorized();
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ batchNumber: "asc" }, { updatedAt: "asc" }],
        include: { article: { select: { id: true, title: true, knowledgeBase: true } }, analysis: { select: { id: true, pipelineStage: true } } },
      },
    },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(job);
}
