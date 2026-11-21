import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: one message. The chat page polls this while the agent is working. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const message = await db.chatMessage.findFirst({ where: { id, conversation: { userId: user.id } } });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(message);
}
