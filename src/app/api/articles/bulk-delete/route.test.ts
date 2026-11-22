import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/articles/delete", () => ({ deleteArticles: h.del }));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/articles/bulk-delete", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "a1", role: "admin" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post({ ids: ["a"] })).status).toBe(401);
  });

  it("returns 403 for non-admins", async () => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    expect((await post({ ids: ["a"] })).status).toBe(403);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("deletes the unique ids and returns the result", async () => {
    h.del.mockResolvedValue({ deleted: 2, busy: ["c"] });
    const res = await post({ ids: ["a", "b", "a", "c"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2, busy: ["c"] });
    expect(h.del).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("returns 400 for an empty list", async () => {
    const res = await post({ ids: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pick at least one article");
  });

  it("returns 400 for more than 200 ids", async () => {
    expect((await post({ ids: Array.from({ length: 201 }, (_, i) => String(i)) })).status).toBe(400);
  });

  it("returns 400 for a missing body", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }));
    expect(res.status).toBe(400);
  });
});
