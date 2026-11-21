import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: your conversations, most recently active first. */
export async function GET() {
  const user = await getUser();
  if (!user) return unauthorized();
  const rows = await db.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, updatedAt: true, _count: { select: { comparisons: true } } },
  });
  return NextResponse.json(rows);
}
