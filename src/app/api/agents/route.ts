import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({
  name: z.string().trim().min(1, "Give the agent a name").max(80, "Keep the name under 80 characters"),
  description: z.string().trim().max(500, "Keep the description under 500 characters"),
  role: z.string().trim().min(10, "Say who the agent is in a sentence or more").max(4000, "Keep the role under 4000 characters"),
  copyFrom: z.string().max(60).optional(),
});

/**
 * Make a URL-safe name from a title.
 * @param name the agent's display name
 * @return lowercase words joined by dashes, never empty
 */
function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "agent";
}

/**
 * POST: create an agent. Admins only.
 * It starts with no tools and no rules, or with a copy of another agent's rules, tools and tool notes.
 * The full prompt is built and stored now, like on every save.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorized();
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can create agents" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const source = parsed.data.copyFrom ? await db.agent.findUnique({ where: { slug: parsed.data.copyFrom } }) : null;
  if (parsed.data.copyFrom && !source) return NextResponse.json({ error: "The agent to copy was not found" }, { status: 404 });

  const base = slugOf(parsed.data.name);
  let slug = base;
  for (let n = 2; await db.agent.findUnique({ where: { slug }, select: { id: true } }); n++) slug = `${base}-${n}`;

  const parts = {
    role: parsed.data.role,
    rules: source?.rules ?? [],
    tools: source?.tools ?? [],
    toolNotes: (source?.toolNotes ?? {}) as Record<string, string>,
  };
  await db.agent.create({
    data: { slug, name: parsed.data.name, description: parsed.data.description, ...parts, prompt: buildSystemPrompt(parts), updatedById: user.id },
  });
  return NextResponse.json({ slug }, { status: 201 });
}
