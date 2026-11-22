import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { tag: { findMany: h.findMany } } }));

import { GET } from ".././route";

describe("GET /api/tags", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("flattens the article count", async () => {
    h.findMany.mockResolvedValue([{ id: "t1", name: "vpn", _count: { articles: 3 } }]);
    const res = await GET();
    expect(await res.json()).toEqual([{ id: "t1", name: "vpn", articles: 3 }]);
    expect(h.findMany.mock.calls[0][0].orderBy).toEqual({ name: "asc" });
  });

  it("returns an empty list when there are no tags", async () => {
    h.findMany.mockResolvedValue([]);
    expect(await (await GET()).json()).toEqual([]);
  });
});
