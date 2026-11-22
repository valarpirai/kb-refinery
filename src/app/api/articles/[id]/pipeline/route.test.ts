import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/pipeline/status", () => ({ getPipelineStatus: h.status }));

import { GET } from "./route";

const call = (id = "a1") => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });

describe("GET /api/articles/[id]/pipeline", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(h.status).not.toHaveBeenCalled();
  });

  it("returns the pipeline status", async () => {
    h.status.mockResolvedValue({ stage: "analyze" });
    const res = await call("a7");
    expect(await res.json()).toEqual({ stage: "analyze" });
    expect(h.status).toHaveBeenCalledWith("a7");
  });

  it("returns 404 when the article has no status", async () => {
    h.status.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
});
