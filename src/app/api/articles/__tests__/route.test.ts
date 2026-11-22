import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { article: { findMany: h.findMany } } }));

import { GET } from ".././route";

describe("GET /api/articles", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.findMany.mockResolvedValue([{ id: "a1", title: "T" }]);
  });

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/articles"))).status).toBe(401);
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("lists articles with no filter when q is absent", async () => {
    const res = await GET(new Request("http://localhost/api/articles"));
    expect(await res.json()).toEqual([{ id: "a1", title: "T" }]);
    const arg = h.findMany.mock.calls[0][0];
    expect(arg.where).toBeUndefined();
    expect(arg.take).toBe(50);
  });

  it("filters by a trimmed, case-insensitive title match", async () => {
    await GET(new Request("http://localhost/api/articles?q=%20vpn%20"));
    expect(h.findMany.mock.calls[0][0].where).toEqual({ title: { contains: "vpn", mode: "insensitive" } });
  });

  it("treats a blank q as no filter", async () => {
    await GET(new Request("http://localhost/api/articles?q=%20%20"));
    expect(h.findMany.mock.calls[0][0].where).toBeUndefined();
  });
});
