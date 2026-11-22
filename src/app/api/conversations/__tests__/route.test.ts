import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { conversation: { findMany: h.findMany } } }));

import { GET } from ".././route";

describe("GET /api/conversations", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("lists only the user's conversations, newest first, max 100", async () => {
    h.findMany.mockResolvedValue([{ id: "c1", title: "T" }]);
    const res = await GET();
    expect(await res.json()).toEqual([{ id: "c1", title: "T" }]);
    const arg = h.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.orderBy).toEqual({ updatedAt: "desc" });
    expect(arg.take).toBe(100);
  });
});
