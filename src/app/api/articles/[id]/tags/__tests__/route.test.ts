import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  articleFind: vi.fn(),
  atCount: vi.fn(),
  atFind: vi.fn(),
  atCreate: vi.fn(),
  tagUpsert: vi.fn(),
  tagFind: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({
  db: {
    article: { findUnique: h.articleFind },
    articleTag: { count: h.atCount, findUnique: h.atFind, create: h.atCreate },
    tag: { upsert: h.tagUpsert, findUnique: h.tagFind },
  },
}));

import { POST } from ".././route";

const post = (body: unknown, id = "a1") =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

describe("POST /api/articles/[id]/tags", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.articleFind.mockResolvedValue({ id: "a1" });
    h.atCount.mockResolvedValue(0);
    h.atFind.mockResolvedValue(null);
    h.tagFind.mockResolvedValue(null);
    h.tagUpsert.mockResolvedValue({ id: "t1", name: "vpn" });
  });

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post({ name: "vpn" })).status).toBe(401);
  });

  it("creates a new tag link with 201 and a normalized name", async () => {
    const res = await post({ name: "  VPN  " });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "t1", name: "vpn" });
    expect(h.tagUpsert).toHaveBeenCalledWith({ where: { name: "vpn" }, create: { name: "vpn" }, update: {} });
    expect(h.atCreate).toHaveBeenCalledWith({ data: { articleId: "a1", tagId: "t1" } });
  });

  it("returns 200 and does not link again when the article already has the tag", async () => {
    h.tagFind.mockResolvedValue({ id: "t1", name: "vpn" });
    h.atFind.mockResolvedValue({ articleId: "a1", tagId: "t1" });
    const res = await post({ name: "vpn" });
    expect(res.status).toBe(200);
    expect(h.atCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty name", async () => {
    expect((await post({ name: "   " })).status).toBe(400);
  });

  it("returns 400 for a name over 40 characters", async () => {
    expect((await post({ name: "x".repeat(41) })).status).toBe(400);
  });

  it("returns 400 for a missing name", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("returns 404 when the article does not exist", async () => {
    h.articleFind.mockResolvedValue(null);
    expect((await post({ name: "vpn" })).status).toBe(404);
    expect(h.tagUpsert).not.toHaveBeenCalled();
  });

  it("returns 409 at the tag limit", async () => {
    h.atCount.mockResolvedValue(20);
    const res = await post({ name: "vpn" });
    expect(res.status).toBe(409);
    expect(h.atCreate).not.toHaveBeenCalled();
    expect(h.tagUpsert).not.toHaveBeenCalled();
  });

  it("does not create a tag row when the article is already at the limit", async () => {
    h.atCount.mockResolvedValue(20);
    await post({ name: "brand-new" });
    expect(h.tagUpsert).not.toHaveBeenCalled();
  });
});
