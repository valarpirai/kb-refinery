import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), restart: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/pipeline/restart", () => ({ restartJobItem: h.restart }));
vi.mock("@/lib/pipeline/run-article", () => ({ STAGES: ["convert", "analyze", "enrich", "rewrite"] }));

import { POST } from ".././route";

const call = (body?: unknown, raw?: string) =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), {
    params: Promise.resolve({ id: "item1" }),
  });

describe("POST /api/job-items/[id]/restart", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call({})).status).toBe(401);
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("restarts from the failed stage when no stage is given", async () => {
    h.restart.mockResolvedValue({ ok: true, fromStage: "enrich" });
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true, fromStage: "enrich" });
    expect(h.restart).toHaveBeenCalledWith("item1", undefined);
  });

  it("passes an earlier stage through", async () => {
    h.restart.mockResolvedValue({ ok: true, fromStage: "analyze" });
    await call({ fromStage: "analyze" });
    expect(h.restart).toHaveBeenCalledWith("item1", "analyze");
  });

  it("returns 400 for an invalid stage", async () => {
    const res = await call({ fromStage: "ready" });
    expect(res.status).toBe(400);
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("returns the status and error from the restart helper", async () => {
    h.restart.mockResolvedValue({ ok: false, status: 409, error: "Item is running" });
    const res = await call({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Item is running" });
  });

  it("returns 404 when the item is missing", async () => {
    h.restart.mockResolvedValue({ ok: false, status: 404, error: "Not found" });
    expect((await call({})).status).toBe(404);
  });
});
