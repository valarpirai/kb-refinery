import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), raw: vi.fn(), count: vi.fn(), groupBy: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: h.raw, analysis: { count: h.count }, comparison: { groupBy: h.groupBy } } }));

import { GET } from ".././route";

describe("GET /api/chat/status", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("tallies verdicts and reports index progress", async () => {
    h.raw.mockResolvedValue([{ n: BigInt(4) }]);
    h.count.mockResolvedValue(9);
    h.groupBy.mockResolvedValue([{ verdict: "original", _count: 2 }, { verdict: "tie", _count: 1 }, { verdict: null, _count: 5 }]);
    const res = await GET();
    expect(await res.json()).toEqual({ tally: { original: 2, refined: 0, tie: 1, neither: 0 }, index: { indexed: 4, total: 9 } });
    expect(h.groupBy.mock.calls[0][0].where).toEqual({ conversation: { userId: "u1" } });
    expect(h.count).toHaveBeenCalledWith({ where: { pipelineStage: "ready" } });
  });

  it("returns zeros when there is no data", async () => {
    h.raw.mockResolvedValue([]);
    h.count.mockResolvedValue(0);
    h.groupBy.mockResolvedValue([]);
    expect(await (await GET()).json()).toEqual({ tally: { original: 0, refined: 0, tie: 0, neither: 0 }, index: { indexed: 0, total: 0 } });
  });
});
