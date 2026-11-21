import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: every tag with how many articles use it. Used for suggestions and the tag filter. */
export async function GET() {
  if (!(await getUser())) return unauthorized();
  const tags = await db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { articles: true } } } });
  return NextResponse.json(tags.map((t) => ({ id: t.id, name: t.name, articles: t._count.articles })));
}
