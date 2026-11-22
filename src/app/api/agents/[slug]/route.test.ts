import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { agent: { findUnique: h.findUnique, update: h.update } } }));
vi.mock("@/lib/agent/catalog", () => ({ TOOL_NAMES: ["search", "read"] }));
vi.mock("@/lib/agent/prompt", () => ({ buildSystemPrompt: (p: { role: string }) => `PROMPT:${p.role}` }));

import { PATCH } from "./route";

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const patch = (body: unknown, slug = "refiner") =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(slug));
const valid = { name: "Refiner", description: "d", role: "You refine articles.", rules: ["a", "", "b"], tools: ["search", "search"], toolNotes: { search: "use it", read: "" } };

describe("PATCH /api/agents/[slug]", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "a1", role: "admin" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await patch(valid)).status).toBe(401);
  });

  it("returns 403 for non-admins", async () => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    expect((await patch(valid)).status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("stores cleaned parts and the built prompt", async () => {
    h.findUnique.mockResolvedValue({ id: "x" });
    h.update.mockResolvedValue({ updatedAt: new Date("2026-01-02T03:04:05Z") });
    const res = await patch(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updatedAt: "2026-01-02T03:04:05.000Z" });
    expect(h.update).toHaveBeenCalledWith({
      where: { slug: "refiner" },
      data: { name: "Refiner", description: "d", role: "You refine articles.", rules: ["a", "b"], tools: ["search"], toolNotes: { search: "use it" }, prompt: "PROMPT:You refine articles.", updatedById: "a1" },
    });
  });

  it("returns 404 for an unknown slug", async () => {
    h.findUnique.mockResolvedValue(null);
    expect((await patch(valid, "ghost")).status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown tool", async () => {
    const res = await patch({ ...valid, tools: ["nuke"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown tool");
  });

  it("returns 400 for an unknown tool in toolNotes", async () => {
    expect((await patch({ ...valid, toolNotes: { nuke: "x" } })).status).toBe(400);
  });

  it("returns 400 for a short role", async () => {
    expect((await patch({ ...valid, role: "tiny" })).status).toBe(400);
  });
});
