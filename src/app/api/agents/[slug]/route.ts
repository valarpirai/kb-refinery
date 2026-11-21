import { NextResponse } from "next/server";
import { z } from "zod";
import { TOOL_NAMES } from "@/lib/agent/catalog";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({
  name: z.string().trim().min(1, "Give the agent a name").max(80, "Keep the name under 80 characters"),
  description: z.string().trim().max(500, "Keep the description under 500 characters"),
  role: z.string().trim().min(10, "Say who the agent is in a sentence or more").max(4000, "Keep the role under 4000 characters"),
  rules: z.array(z.string().trim().max(600, "Keep each rule under 600 characters")).max(40, "Keep it to 40 rules"),
  tools: z.array(z.string()).refine((t) => t.every((n) => TOOL_NAMES.includes(n)), "Unknown tool"),
  toolNotes: z.record(z.string(), z.string().trim().max(1500, "Keep each tool note under 1500 characters")).refine((n) => Object.keys(n).every((k) => TOOL_NAMES.includes(k)), "Unknown tool"),
});

/**
 * PATCH: edit an agent. Admins only, because the agent serves everyone.
 * Saving builds the full prompt from the parts and stores it. The worker runs the stored prompt, so the change applies to the next message.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getUser();
  if (!user) return unauthorized();
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can edit agents" }, { status: 403 });
  const { slug } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const found = await db.agent.findUnique({ where: { slug }, select: { id: true } });
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parts = {
    role: parsed.data.role,
    rules: parsed.data.rules.filter(Boolean),
    tools: [...new Set(parsed.data.tools)],
    toolNotes: Object.fromEntries(Object.entries(parsed.data.toolNotes).filter(([, v]) => v)),
  };
  // The prompt is built here, from the validated parts, and stored. The worker runs it as is.
  const agent = await db.agent.update({
    where: { slug },
    data: { name: parsed.data.name, description: parsed.data.description, ...parts, prompt: buildSystemPrompt(parts), updatedById: user.id },
  });
  return NextResponse.json({ updatedAt: agent.updatedAt.toISOString() });
}
