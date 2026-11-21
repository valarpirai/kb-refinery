import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBody = z.object({
  verdict: z.enum(["original", "refined", "tie", "neither"]).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

/** GET: one comparison with both arms. The chat page polls this. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comparison = await db.comparison.findUnique({ where: { id }, include: { arms: true } });
  if (!comparison) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(comparison);
}

/** PATCH: record which answer you preferred, with an optional note. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!(await db.comparison.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await db.comparison.update({ where: { id }, data: parsed.data, include: { arms: true } }));
}
