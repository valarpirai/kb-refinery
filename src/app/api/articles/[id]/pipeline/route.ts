import { NextResponse } from "next/server";
import { getPipelineStatus } from "@/lib/pipeline/status";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: where this article is in the pipeline. The pipeline view polls this while a run is active. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return unauthorized();
  const { id } = await params;
  const status = await getPipelineStatus(id);
  if (!status) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(status);
}
