import { NextResponse } from "next/server";
import { z } from "zod";
import { startAgentTurn } from "@/lib/agent/start";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({
  text: z.string().trim().min(1, "Say something").max(4000, "Keep it under 4000 characters"),
  conversationId: z.string().optional(),
});

/** POST: send a message to the agent. Returns ids to poll; the worker runs the agent. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const ids = await startAgentTurn(user.id, parsed.data.text, { conversationId: parsed.data.conversationId });
    return NextResponse.json(ids, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
