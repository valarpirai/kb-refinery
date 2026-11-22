import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn(), createJob: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: h.findMany } } }));
vi.mock("@/lib/pipeline/jobs", () => ({ createJob: h.createJob }));

import { GET, POST } from "./route";

const post = (body?: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

describe("/api/jobs", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  describe("GET", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await GET()).status).toBe(401);
    });

    it("lists the 20 newest jobs", async () => {
      h.findMany.mockResolvedValue([{ id: "j1" }]);
      const res = await GET();
      expect(await res.json()).toEqual([{ id: "j1" }]);
      expect(h.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" }, take: 20 });
    });
  });

  describe("POST", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await post({})).status).toBe(401);
      expect(h.createJob).not.toHaveBeenCalled();
    });

    it("creates a job for the given articles", async () => {
      h.createJob.mockResolvedValue({ id: "j1", items: [{}, {}] });
      const res = await post({ articleIds: ["a", "b"] });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: "j1", items: 2 });
      expect(h.createJob).toHaveBeenCalledWith(["a", "b"]);
    });

    it("creates a job for all articles when the body is empty", async () => {
      h.createJob.mockResolvedValue({ id: "j2", items: [{}] });
      const res = await post();
      expect(res.status).toBe(201);
      expect(h.createJob).toHaveBeenCalledWith(undefined);
    });

    it("returns 400 when articleIds is not a list of strings", async () => {
      const res = await post({ articleIds: "a" });
      expect(res.status).toBe(400);
      expect(h.createJob).not.toHaveBeenCalled();
    });

    it("returns 400 with the message when there is nothing to refine", async () => {
      h.createJob.mockRejectedValue(new Error("No articles to refine"));
      const res = await post({});
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "No articles to refine" });
    });
  });
});
