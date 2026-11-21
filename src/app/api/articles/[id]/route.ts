import { NextResponse } from "next/server";
import { deleteArticles } from "@/lib/articles/delete";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/** DELETE: remove one article and everything under it. Admins only. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return unauthorized();
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can delete articles" }, { status: 403 });
  const { id } = await params;
  const result = await deleteArticles([id]);
  if (result.busy.length) return NextResponse.json({ error: "A worker is processing this article. Try again when it finishes." }, { status: 409 });
  if (result.deleted === 0) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  return NextResponse.json({ deleted: 1 });
}
