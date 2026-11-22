import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), owned: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/chat/access", () => ({ ownedComparison: h.owned }));
vi.mock("@/lib/db", () => ({ db: { comparison: { update: h.update } } }));

import { GET, PATCH } from ".././route";

const ctx = (id = "cmp1") => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) => PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx());

describe("/api/compare/[id]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  describe("GET", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await GET(new Request("http://localhost/x"), ctx())).status).toBe(401);
    });

    it("returns the comparison for its owner", async () => {
      h.owned.mockResolvedValue({ id: "cmp1", arms: [] });
      const res = await GET(new Request("http://localhost/x"), ctx());
      expect(await res.json()).toEqual({ id: "cmp1", arms: [] });
      expect(h.owned).toHaveBeenCalledWith("cmp1", "u1");
    });

    it("returns 404 when not found or not owned", async () => {
      h.owned.mockResolvedValue(null);
      expect((await GET(new Request("http://localhost/x"), ctx())).status).toBe(404);
    });
  });

  describe("PATCH", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await patch({ verdict: "tie" })).status).toBe(401);
    });

    it("records the verdict and note", async () => {
      h.owned.mockResolvedValue({ id: "cmp1" });
      h.update.mockResolvedValue({ id: "cmp1", verdict: "refined", note: "better" });
      const res = await patch({ verdict: "refined", note: "better" });
      expect(res.status).toBe(200);
      expect(h.update).toHaveBeenCalledWith({ where: { id: "cmp1" }, data: { verdict: "refined", note: "better" }, include: { arms: true } });
    });

    it("allows clearing the verdict with null", async () => {
      h.owned.mockResolvedValue({ id: "cmp1" });
      h.update.mockResolvedValue({ id: "cmp1" });
      expect((await patch({ verdict: null })).status).toBe(200);
      expect(h.update.mock.calls[0][0].data).toEqual({ verdict: null });
    });

    it("returns 400 for an unknown verdict", async () => {
      expect((await patch({ verdict: "both" })).status).toBe(400);
      expect(h.update).not.toHaveBeenCalled();
    });

    it("returns 400 for a note over 2000 characters", async () => {
      expect((await patch({ note: "n".repeat(2001) })).status).toBe(400);
    });

    it("returns 404 when the comparison is not owned", async () => {
      h.owned.mockResolvedValue(null);
      expect((await patch({ verdict: "tie" })).status).toBe(404);
      expect(h.update).not.toHaveBeenCalled();
    });
  });
});
