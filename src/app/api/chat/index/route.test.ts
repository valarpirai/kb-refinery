import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), raw: vi.fn(), groupBy: vi.fn(), send: vi.fn(), getBoss: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: h.raw, chunk: { groupBy: h.groupBy } } }));
vi.mock("@/lib/queue", () => ({ INDEX_QUEUE: "index-articles", getBoss: h.getBoss }));

import { GET, POST } from "./route";

describe("/api/chat/index", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.getBoss.mockResolvedValue({ send: h.send });
  });

  describe("GET", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await GET()).status).toBe(401);
    });

    it("reports the article count and chunks per variant", async () => {
      h.raw.mockResolvedValue([{ n: BigInt(7) }]);
      h.groupBy.mockResolvedValue([{ variant: "original", _count: 10 }, { variant: "refined", _count: 12 }]);
      const res = await GET();
      expect(await res.json()).toEqual({ articles: 7, chunks: { original: 10, refined: 12 } });
    });

    it("reports zero when nothing is indexed", async () => {
      h.raw.mockResolvedValue([]);
      h.groupBy.mockResolvedValue([]);
      expect(await (await GET()).json()).toEqual({ articles: 0, chunks: {} });
    });
  });

  describe("POST", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await POST()).status).toBe(401);
      expect(h.send).not.toHaveBeenCalled();
    });

    it("queues a rebuild and returns 202", async () => {
      const res = await POST();
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ queued: true });
      expect(h.send).toHaveBeenCalledWith("index-articles", {});
    });
  });
});
