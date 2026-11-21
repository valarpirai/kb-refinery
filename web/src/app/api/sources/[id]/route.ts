import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { syncSchedule } from "@/lib/ingest/schedule";
import { redact } from "@/lib/ingest/sources";

export const runtime = "nodejs";

const patchBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  cron: z.string().trim().nullable().optional(),
  enabled: z.boolean().optional(),
});

/** PATCH: change name, schedule or enabled flag. To change the connection, delete and re-add. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const existing = await db.dataSource.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = { ...body.data, ...(body.data.cron !== undefined ? { cron: body.data.cron || null } : {}) };
  const updated = await db.dataSource.update({ where: { id }, data });
  try {
    await syncSchedule(updated);
  } catch (e) {
    await db.dataSource.update({ where: { id }, data: { cron: existing.cron, enabled: existing.enabled, name: existing.name } });
    return NextResponse.json({ error: `Bad schedule: ${(e as Error).message}` }, { status: 400 });
  }
  return NextResponse.json(redact(updated));
}

/** DELETE: remove the source and its schedule. Imported articles stay. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.dataSource.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await syncSchedule({ id, cron: null, enabled: false });
  await db.dataSource.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
