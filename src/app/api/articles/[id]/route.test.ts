import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/articles/delete", () => ({ deleteArticles: h.del }));

import { DELETE } from "./route";

const call = (id = "a1") => DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id }) });

describe("DELETE /api/articles/[id]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "a1", role: "admin" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("returns 403 for non-admins", async () => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    expect((await call()).status).toBe(403);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("deletes the article", async () => {
    h.del.mockResolvedValue({ deleted: 1, busy: [] });
    const res = await call("a9");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(h.del).toHaveBeenCalledWith(["a9"]);
  });

  it("returns 409 when a worker is processing it", async () => {
    h.del.mockResolvedValue({ deleted: 0, busy: ["a1"] });
    expect((await call()).status).toBe(409);
  });

  it("returns 404 when nothing was deleted", async () => {
    h.del.mockResolvedValue({ deleted: 0, busy: [] });
    expect((await call()).status).toBe(404);
  });
});
