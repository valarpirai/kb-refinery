import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { notification: { findMany: h.findMany, count: h.count } } }));

import { GET } from "./route";

describe("GET /api/notifications", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns the user's latest items and unread count", async () => {
    h.findMany.mockResolvedValue([{ id: "n1" }]);
    h.count.mockResolvedValue(3);
    const res = await GET();
    expect(await res.json()).toEqual({ unread: 3, items: [{ id: "n1" }] });
    expect(h.findMany).toHaveBeenCalledWith({ where: { userId: "u1" }, orderBy: { createdAt: "desc" }, take: 30 });
    expect(h.count).toHaveBeenCalledWith({ where: { userId: "u1", readAt: null } });
  });
});
