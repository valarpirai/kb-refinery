import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";
import { MAX_TAGS_PER_ARTICLE, normalizeTag } from "@/lib/tags";

export const runtime = "nodejs";

const body = z.object({ name: z.string() });

/** POST: add a tag to an article, creating the tag if it is new. Adding one it already has is a no-op. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return unauthorized();
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  const name = parsed.success ? normalizeTag(parsed.data.name) : null;
  if (!name) return NextResponse.json({ error: "A tag is 1 to 40 characters" }, { status: 400 });
  if (!(await db.article.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const has = await db.articleTag.count({ where: { articleId: id } });
  const existing = await db.tag.findUnique({ where: { name } });
  const already = existing ? await db.articleTag.findUnique({ where: { articleId_tagId: { articleId: id, tagId: existing.id } } }) : null;
  // Check the limit before creating a tag, so a refused request leaves no orphan row.
  if (!already && has >= MAX_TAGS_PER_ARTICLE) return NextResponse.json({ error: `An article can have up to ${MAX_TAGS_PER_ARTICLE} tags` }, { status: 409 });
  const tag = existing ?? (await db.tag.upsert({ where: { name }, create: { name }, update: {} }));
  if (!already) await db.articleTag.create({ data: { articleId: id, tagId: tag.id } });
  return NextResponse.json({ id: tag.id, name: tag.name }, { status: already ? 200 : 201 });
}
