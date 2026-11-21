import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteArticles } from "@/lib/articles/delete";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ ids: z.array(z.string()).min(1, "Pick at least one article").max(200, "Delete up to 200 at a time") });

/** POST {ids}: remove several articles. Admins only. Articles a worker is processing are skipped and listed. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorized();
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can delete articles" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  return NextResponse.json(await deleteArticles([...new Set(parsed.data.ids)]));
}
