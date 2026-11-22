import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { chatMessage: { findFirst: h.findFirst } } }));

import { GET } from ".././route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/agent/messages/[id]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx("m1"));
    expect(res.status).toBe(401);
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it("returns the message, scoped to the user's conversations", async () => {
    h.findFirst.mockResolvedValue({ id: "m1", content: "hi" });
    const res = await GET(new Request("http://localhost/x"), ctx("m1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "m1", content: "hi" });
    expect(h.findFirst).toHaveBeenCalledWith({ where: { id: "m1", conversation: { userId: "u1" } } });
  });

  it("returns 404 when the message is not found", async () => {
    h.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx("nope"));
    expect(res.status).toBe(404);
  });
});
