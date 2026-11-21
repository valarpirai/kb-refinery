import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pullNow } from "@/lib/ingest/schedule";

export const runtime = "nodejs";

/** POST: queue a pull now. The worker does the fetch. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await db.dataSource.findUnique({ where: { id }, select: { id: true } }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await pullNow(id);
  return NextResponse.json({ queued: true }, { status: 202 });
}
