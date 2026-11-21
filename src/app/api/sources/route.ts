import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { configSchemas } from "@/lib/ingest/connectors";
import { syncSchedule } from "@/lib/ingest/schedule";
import { redact } from "@/lib/ingest/sources";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["rest_json", "url_crawl"]),
  config: z.unknown(),
  cron: z.string().trim().optional(),
  enabled: z.boolean().default(true),
});

/** GET: all data sources, newest first, with secrets removed. */
export async function GET() {
  if (!(await getUser())) return unauthorized();
  const sources = await db.dataSource.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(sources.map(redact));
}

/** POST: create a data source and, when it has a cron expression, schedule it. */
export async function POST(req: Request) {
  if (!(await getUser())) return unauthorized();
  const body = createBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { name, type, cron, enabled } = body.data;
  const config = configSchemas[type].safeParse(body.data.config);
  if (!config.success) return NextResponse.json({ error: `Config: ${config.error.issues[0]?.message}` }, { status: 400 });

  const source = await db.dataSource.create({ data: { name, type, config: config.data, cron: cron || null, enabled } });
  try {
    await syncSchedule(source);
  } catch (e) {
    await db.dataSource.delete({ where: { id: source.id } });
    return NextResponse.json({ error: `Bad schedule: ${(e as Error).message}` }, { status: 400 });
  }
  return NextResponse.json(redact(source), { status: 201 });
}
