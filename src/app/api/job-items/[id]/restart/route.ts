import { NextResponse } from "next/server";
import { z } from "zod";
import { restartJobItem } from "@/lib/pipeline/restart";
import { STAGES } from "@/lib/pipeline/run-article";
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

  const result = await restartJobItem(id, parsed.data.fromStage);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ queued: true, fromStage: result.fromStage }, { status: 202 });
}
