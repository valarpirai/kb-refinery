import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), atDelete: vi.fn(), atCount: vi.fn(), tagDelete: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { articleTag: { deleteMany: h.atDelete, count: h.atCount }, tag: { deleteMany: h.tagDelete } } }));

import { DELETE } from "./route";

const call = () => DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: "a1", tagId: "t1" }) });

describe("DELETE /api/articles/[id]/tags/[tagId]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(h.atDelete).not.toHaveBeenCalled();
  });

  it("removes the link and keeps a tag that other articles use", async () => {
    h.atDelete.mockResolvedValue({ count: 1 });
    h.atCount.mockResolvedValue(2);
    const res = await call();
    expect(res.status).toBe(204);
    expect(h.atDelete).toHaveBeenCalledWith({ where: { articleId: "a1", tagId: "t1" } });
    expect(h.tagDelete).not.toHaveBeenCalled();
  });

  it("removes a tag that no article uses any more", async () => {
    h.atDelete.mockResolvedValue({ count: 1 });
    h.atCount.mockResolvedValue(0);
    expect((await call()).status).toBe(204);
    expect(h.tagDelete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });

  it("returns 404 when the article does not have the tag", async () => {
    h.atDelete.mockResolvedValue({ count: 0 });
    expect((await call()).status).toBe(404);
    expect(h.tagDelete).not.toHaveBeenCalled();
  });
});
