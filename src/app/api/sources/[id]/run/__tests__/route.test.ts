import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findUnique: vi.fn(), pullNow: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { dataSource: { findUnique: h.findUnique } } }));
vi.mock("@/lib/ingest/schedule", () => ({ pullNow: h.pullNow }));

import { POST } from ".././route";

const call = () => POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "s1" }) });

describe("POST /api/sources/[id]/run", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(h.pullNow).not.toHaveBeenCalled();
  });

  it("queues a pull and returns 202", async () => {
    h.findUnique.mockResolvedValue({ id: "s1" });
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true });
    expect(h.pullNow).toHaveBeenCalledWith("s1");
  });

  it("returns 404 for an unknown source", async () => {
    h.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(h.pullNow).not.toHaveBeenCalled();
  });
});
