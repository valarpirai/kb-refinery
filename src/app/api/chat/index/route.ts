import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBoss, INDEX_QUEUE } from "@/lib/queue";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: how much is indexed. */
export async function GET() {
  if (!(await getUser())) return unauthorized();
  const [articles, byVariant] = await Promise.all([
    db.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT "articleId") AS n FROM "Chunk"`,
    db.chunk.groupBy({ by: ["variant"], _count: true }),
  ]);
  return NextResponse.json({ articles: Number(articles[0]?.n ?? 0), chunks: Object.fromEntries(byVariant.map((v) => [v.variant, v._count])) });
}

/** POST: queue a rebuild of the whole index. */
export async function POST() {
  if (!(await getUser())) return unauthorized();
  await (await getBoss()).send(INDEX_QUEUE, {});
  return NextResponse.json({ queued: true }, { status: 202 });
}
