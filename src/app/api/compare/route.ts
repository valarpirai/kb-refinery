import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ANSWER_QUEUE, getBoss } from "@/lib/queue";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({
  query: z.string().trim().min(3, "Ask a longer question").max(1000, "Keep the question under 1000 characters"),
  conversationId: z.string().optional(),
});

/** Short conversation title from the first question. */
function titleFor(query: string): string {
  return query.length > 60 ? `${query.slice(0, 57)}…` : query;
}

/**
 * POST: ask one question against both the original and refined content.
 * Adds it to an existing conversation of yours, or starts a new one.
 * Returns the conversation and comparison ids to poll.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if ((await db.chunk.count()) === 0) {
    return NextResponse.json({ error: "Nothing is indexed yet. Refine some articles first, or rebuild the index." }, { status: 409 });
  }

  const { query, conversationId } = parsed.data;
  let convId = conversationId;
  if (convId) {
    if (!(await db.conversation.findFirst({ where: { id: convId, userId: user.id }, select: { id: true } }))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    await db.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
  } else {
    convId = (await db.conversation.create({ data: { userId: user.id, title: titleFor(query) } })).id;
  }

  const comparison = await db.comparison.create({
    data: { conversationId: convId, query, arms: { create: [{ variant: "original" }, { variant: "refined" }] } },
    include: { arms: true },
  });
  const boss = await getBoss();
  for (const arm of comparison.arms) await boss.send(ANSWER_QUEUE, { armId: arm.id });
  return NextResponse.json({ id: comparison.id, conversationId: convId }, { status: 201 });
}
