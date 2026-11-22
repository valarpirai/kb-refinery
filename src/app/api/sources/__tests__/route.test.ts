import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn(), create: vi.fn(), del: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { dataSource: { findMany: h.findMany, create: h.create, delete: h.del } } }));
vi.mock("@/lib/ingest/schedule", () => ({ syncSchedule: h.sync }));
vi.mock("@/lib/agent/start", () => ({ startAgentTurn: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/ingest/import", () => ({ runImport: vi.fn() }));

import { GET, POST } from ".././route";

const post = (body: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const valid = { name: "Docs", type: "rest_json", config: { url: "https://example.com/api", authHeader: "Bearer secret" }, cron: "0 * * * *" };

describe("/api/sources", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.sync.mockReset();
    h.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "s1", ...data }));
  });

  describe("GET", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await GET()).status).toBe(401);
    });

    it("lists sources with the auth header removed", async () => {
      h.findMany.mockResolvedValue([{ id: "s1", name: "Docs", config: { url: "https://x.test", authHeader: "Bearer secret" } }]);
      const res = await GET();
      const text = await res.text();
      expect(text).not.toContain("secret");
      expect(JSON.parse(text)).toEqual([{ id: "s1", name: "Docs", config: { url: "https://x.test", hasAuthHeader: true } }]);
    });
  });

  describe("POST", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await post(valid)).status).toBe(401);
    });

    it("creates and schedules a source, hiding the secret in the response", async () => {
      const res = await post(valid);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.config.hasAuthHeader).toBe(true);
      expect(body.config.authHeader).toBeUndefined();
      expect(h.create.mock.calls[0][0].data).toMatchObject({ name: "Docs", type: "rest_json", cron: "0 * * * *", enabled: true });
      expect(h.create.mock.calls[0][0].data.config.authHeader).toBe("Bearer secret");
      expect(h.sync).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    });

    it("stores a null cron when none is given", async () => {
      await post({ ...valid, cron: undefined });
      expect(h.create.mock.calls[0][0].data.cron).toBeNull();
    });

    it("returns 400 for an unknown type", async () => {
      expect((await post({ ...valid, type: "ftp" })).status).toBe(400);
      expect(h.create).not.toHaveBeenCalled();
    });

    it("returns 400 for an empty name", async () => {
      expect((await post({ ...valid, name: " " })).status).toBe(400);
    });

    it("returns 400 for an invalid connector config", async () => {
      const res = await post({ ...valid, config: { url: "not a url" } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/^Config: /);
      expect(h.create).not.toHaveBeenCalled();
    });

    it("rolls back the source when the schedule is bad", async () => {
      h.sync.mockRejectedValue(new Error("bad cron"));
      const res = await post(valid);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Bad schedule: bad cron" });
      expect(h.del).toHaveBeenCalledWith({ where: { id: "s1" } });
    });
  });
});
