import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createJob } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";

const body = z.object({ articleIds: z.array(z.string()).optional() });

/** GET: recent jobs, newest first. */
export async function GET() {
  const jobs = await db.job.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return NextResponse.json(jobs);
}

/** POST: start a refine job for the given articles, or all articles when none are given. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "articleIds must be a list of ids" }, { status: 400 });
  try {
    const job = await createJob(parsed.data.articleIds);
    return NextResponse.json({ id: job.id, items: job.items.length }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
