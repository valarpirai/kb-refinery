import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: h.findUnique } } }));

import { GET } from "./route";

const call = (id = "j1") => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });

describe("GET /api/jobs/[id]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("returns the job with its items", async () => {
    h.findUnique.mockResolvedValue({ id: "j1", items: [{ id: "i1" }] });
    const res = await call("j1");
    expect(await res.json()).toEqual({ id: "j1", items: [{ id: "i1" }] });
    const arg = h.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "j1" });
    expect(arg.include.items.orderBy).toEqual([{ batchNumber: "asc" }, { updatedAt: "asc" }]);
  });

  it("returns 404 when the job is missing", async () => {
    h.findUnique.mockResolvedValue(null);
    expect((await call("nope")).status).toBe(404);
  });
});
