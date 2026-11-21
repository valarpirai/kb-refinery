import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ANSWER_QUEUE, getBoss } from "@/lib/queue";

export const runtime = "nodejs";

const body = z.object({ query: z.string().trim().min(3, "Ask a longer question").max(1000, "Keep the question under 1000 characters") });

/** POST: ask one question against both the original and refined content. Returns the comparison to poll. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if ((await db.chunk.count()) === 0) {
    return NextResponse.json({ error: "Nothing is indexed yet. Refine some articles first, or rebuild the index." }, { status: 409 });
  }
  const comparison = await db.comparison.create({
    data: { query: parsed.data.query, arms: { create: [{ variant: "original" }, { variant: "refined" }] } },
    include: { arms: true },
  });
  const boss = await getBoss();
  for (const arm of comparison.arms) await boss.send(ANSWER_QUEUE, { armId: arm.id });
  return NextResponse.json({ id: comparison.id }, { status: 201 });
}
