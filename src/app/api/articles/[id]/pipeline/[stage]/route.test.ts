import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/pipeline/stage-detail", () => ({ getStageDetail: h.detail }));

import { GET } from "./route";

const call = (id: string, stage: string) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id, stage }) });

describe("GET /api/articles/[id]/pipeline/[stage]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call("a1", "convert")).status).toBe(401);
  });

  it.each(["import", "convert", "analyze", "enrich", "rewrite", "ready"])("returns detail for stage %s", async (stage) => {
    h.detail.mockResolvedValue({ stage });
    const res = await call("a1", stage);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stage });
    expect(h.detail).toHaveBeenCalledWith("a1", stage);
  });

  it("returns 400 for an unknown stage", async () => {
    const res = await call("a1", "bogus");
    expect(res.status).toBe(400);
    expect(h.detail).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no detail", async () => {
    h.detail.mockResolvedValue(null);
    expect((await call("a1", "convert")).status).toBe(404);
  });
});
