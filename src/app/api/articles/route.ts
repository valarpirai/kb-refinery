import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/** GET ?q=: articles whose title matches, for the refine picker. Max 50. */
export async function GET(req: Request) {
  if (!(await getUser())) return unauthorized();
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const articles = await db.article.findMany({
    where: q ? { title: { contains: q, mode: "insensitive" } } : undefined,
    select: { id: true, title: true, knowledgeBase: true, analysis: { select: { pipelineStage: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json(articles);
}
