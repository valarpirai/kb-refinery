import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { notification: { updateMany: h.updateMany } } }));

import { POST } from "./route";

const post = (body?: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

describe("POST /api/notifications/read", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.updateMany.mockResolvedValue({ count: 2 });
  });

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("marks only the given ids, scoped to the user", async () => {
    const res = await post({ ids: ["n1", "n2"] });
    expect(await res.json()).toEqual({ marked: 2 });
    const arg = h.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1", readAt: null, id: { in: ["n1", "n2"] } });
    expect(arg.data.readAt).toBeInstanceOf(Date);
  });

  it("marks all unread when no ids are given", async () => {
    await post();
    expect(h.updateMany.mock.calls[0][0].where).toEqual({ userId: "u1", readAt: null });
  });

  it("returns 400 for more than 100 ids", async () => {
    const res = await post({ ids: Array.from({ length: 101 }, (_, i) => String(i)) });
    expect(res.status).toBe(400);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when ids is not a list", async () => {
    expect((await post({ ids: "n1" })).status).toBe(400);
  });
});
