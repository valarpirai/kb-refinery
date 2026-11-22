import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { conversation: { findFirst: h.findFirst, updateMany: h.updateMany, deleteMany: h.deleteMany } } }));

import { DELETE, GET, PATCH } from "./route";

const ctx = (id = "c1") => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("/api/conversations/[id]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  describe("GET", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await GET(req("GET"), ctx())).status).toBe(401);
    });

    it("returns the conversation scoped to the user", async () => {
      h.findFirst.mockResolvedValue({ id: "c1", comparisons: [], messages: [] });
      const res = await GET(req("GET"), ctx());
      expect(await res.json()).toEqual({ id: "c1", comparisons: [], messages: [] });
      expect(h.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", userId: "u1" });
    });

    it("returns 404 when missing", async () => {
      h.findFirst.mockResolvedValue(null);
      expect((await GET(req("GET"), ctx())).status).toBe(404);
    });
  });

  describe("PATCH", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await PATCH(req("PATCH", { title: "x" }), ctx())).status).toBe(401);
    });

    it("renames with a trimmed title", async () => {
      h.updateMany.mockResolvedValue({ count: 1 });
      const res = await PATCH(req("PATCH", { title: "  New  " }), ctx());
      expect(await res.json()).toEqual({ ok: true });
      expect(h.updateMany).toHaveBeenCalledWith({ where: { id: "c1", userId: "u1" }, data: { title: "New" } });
    });

    it("returns 400 for an empty title", async () => {
      expect((await PATCH(req("PATCH", { title: "  " }), ctx())).status).toBe(400);
    });

    it("returns 400 for a title over 120 characters", async () => {
      expect((await PATCH(req("PATCH", { title: "t".repeat(121) }), ctx())).status).toBe(400);
    });

    it("returns 404 when no conversation matched", async () => {
      h.updateMany.mockResolvedValue({ count: 0 });
      expect((await PATCH(req("PATCH", { title: "ok" }), ctx())).status).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await DELETE(req("DELETE"), ctx())).status).toBe(401);
    });

    it("deletes and returns 204", async () => {
      h.deleteMany.mockResolvedValue({ count: 1 });
      const res = await DELETE(req("DELETE"), ctx());
      expect(res.status).toBe(204);
      expect(h.deleteMany).toHaveBeenCalledWith({ where: { id: "c1", userId: "u1" } });
    });

    it("returns 404 when nothing matched", async () => {
      h.deleteMany.mockResolvedValue({ count: 0 });
      expect((await DELETE(req("DELETE"), ctx())).status).toBe(404);
    });
  });
});
