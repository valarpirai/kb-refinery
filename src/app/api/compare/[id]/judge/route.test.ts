import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), owned: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/chat/access", () => ({ ownedComparison: h.owned }));
vi.mock("@/lib/queue", () => ({ JUDGE_QUEUE: "judge-comparison", getBoss: async () => ({ send: h.send }) }));

import { POST } from "./route";

const call = () => POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "cmp1" }) });

describe("POST /api/compare/[id]/judge", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("queues the judge when both arms are completed", async () => {
    h.owned.mockResolvedValue({ arms: [{ status: "completed" }, { status: "completed" }] });
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true });
    expect(h.send).toHaveBeenCalledWith("judge-comparison", { comparisonId: "cmp1" });
  });

  it("returns 404 when the comparison is not owned", async () => {
    h.owned.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("returns 409 when an arm has not finished", async () => {
    h.owned.mockResolvedValue({ arms: [{ status: "completed" }, { status: "running" }] });
    expect((await call()).status).toBe(409);
    expect(h.send).not.toHaveBeenCalled();
  });
});
