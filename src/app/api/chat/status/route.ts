import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: index progress and the signed-in user's verdict totals. */
export async function GET() {
  const user = await getUser();
  if (!user) return unauthorized();

  const [indexed, total, verdicts] = await Promise.all([
    db.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT "articleId") AS n FROM "Chunk"`,
    db.analysis.count({ where: { pipelineStage: "ready" } }),
    db.comparison.groupBy({ by: ["verdict"], where: { conversation: { userId: user.id } }, _count: true }),
  ]);

  const tally = { original: 0, refined: 0, tie: 0, neither: 0 };
  verdicts.forEach((v) => {
    if (v.verdict) tally[v.verdict] = v._count;
  });
  return NextResponse.json({ tally, index: { indexed: Number(indexed[0]?.n ?? 0), total } });
}
