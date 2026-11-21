import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBoss, INDEX_QUEUE } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: how much is indexed. */
export async function GET() {
  const [articles, byVariant] = await Promise.all([
    db.chunk.findMany({ distinct: ["articleId"], select: { articleId: true } }),
    db.chunk.groupBy({ by: ["variant"], _count: true }),
  ]);
  return NextResponse.json({ articles: articles.length, chunks: Object.fromEntries(byVariant.map((v) => [v.variant, v._count])) });
}

/** POST: queue a rebuild of the whole index. */
export async function POST() {
  await (await getBoss()).send(INDEX_QUEUE, {});
  return NextResponse.json({ queued: true }, { status: 202 });
}
