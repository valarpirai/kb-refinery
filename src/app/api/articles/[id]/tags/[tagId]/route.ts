import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/** DELETE: take a tag off an article. A tag no article uses any more is removed. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; tagId: string }> }) {
  if (!(await getUser())) return unauthorized();
  const { id, tagId } = await params;
  const result = await db.articleTag.deleteMany({ where: { articleId: id, tagId } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((await db.articleTag.count({ where: { tagId } })) === 0) await db.tag.deleteMany({ where: { id: tagId } });
  return new NextResponse(null, { status: 204 });
}
