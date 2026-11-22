import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findUnique: vi.fn(), update: vi.fn(), del: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { dataSource: { findUnique: h.findUnique, update: h.update, delete: h.del } } }));
vi.mock("@/lib/ingest/schedule", () => ({ syncSchedule: h.sync }));

import { DELETE, PATCH } from "./route";

const ctx = (id = "s1") => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) => PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx());
const existing = { id: "s1", name: "Old", cron: "0 * * * *", enabled: true, config: {} };

describe("/api/sources/[id]", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.sync.mockReset();
    h.findUnique.mockResolvedValue(existing);
    h.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existing, ...data }));
  });

  describe("PATCH", () => {
    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await patch({ name: "x" })).status).toBe(401);
    });

    it("updates and re-syncs the schedule", async () => {
      const res = await patch({ name: "New", enabled: false });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ name: "New", enabled: false });
      expect(h.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { name: "New", enabled: false } });
      expect(h.sync).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", enabled: false }));
    });

    it("turns an empty cron into null", async () => {
      await patch({ cron: "" });
      expect(h.update.mock.calls[0][0].data.cron).toBeNull();
    });

    it("returns 400 for an invalid body", async () => {
      expect((await patch({ enabled: "yes" })).status).toBe(400);
      expect(h.update).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown source", async () => {
      h.findUnique.mockResolvedValue(null);
      expect((await patch({ name: "x" })).status).toBe(404);
    });

    it("restores the old values when the schedule is bad", async () => {
      h.sync.mockRejectedValue(new Error("bad cron"));
      const res = await patch({ name: "New", cron: "nope" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Bad schedule: bad cron");
      expect(h.update).toHaveBeenCalledTimes(2);
      expect(h.update.mock.calls[1][0]).toEqual({ where: { id: "s1" }, data: { cron: "0 * * * *", enabled: true, name: "Old" } });
    });
  });

  describe("DELETE", () => {
    const del = () => DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx());

    it("returns 401 without a session", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await del()).status).toBe(401);
    });

    it("removes the schedule, then the source", async () => {
      const res = await del();
      expect(res.status).toBe(204);
      expect(h.sync).toHaveBeenCalledWith({ id: "s1", cron: null, enabled: false });
      expect(h.del).toHaveBeenCalledWith({ where: { id: "s1" } });
    });

    it("returns 404 for an unknown source", async () => {
      h.findUnique.mockResolvedValue(null);
      expect((await del()).status).toBe(404);
      expect(h.del).not.toHaveBeenCalled();
    });
  });
});
