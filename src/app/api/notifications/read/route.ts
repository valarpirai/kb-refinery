import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ ids: z.array(z.string()).max(100).optional() });

/** POST: mark some notifications read, or all of yours when no ids are given. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const result = await db.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(parsed.data.ids ? { id: { in: parsed.data.ids } } : {}) },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ marked: result.count });
}
