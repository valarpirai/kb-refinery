import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), findUnique: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({ db: { agent: { findUnique: h.findUnique, create: h.create } } }));
vi.mock("@/lib/agent/prompt", () => ({ buildSystemPrompt: (p: { role: string }) => `PROMPT:${p.role}` }));

import { POST } from ".././route";

const post = (body: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const valid = { name: "My Agent!", description: "d", role: "You are a helpful agent." };

describe("POST /api/agents", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "a1", role: "admin" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post(valid)).status).toBe(401);
  });

  it("returns 403 for non-admins", async () => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    expect((await post(valid)).status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("creates an agent with a slug from the name and an empty start", async () => {
    h.findUnique.mockResolvedValue(null);
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ slug: "my-agent" });
    expect(h.create).toHaveBeenCalledWith({
      data: { slug: "my-agent", name: "My Agent!", description: "d", role: valid.role, rules: [], tools: [], toolNotes: {}, prompt: `PROMPT:${valid.role}`, updatedById: "a1" },
    });
  });

  it("adds a numeric suffix when the slug is taken", async () => {
    h.findUnique.mockResolvedValueOnce({ id: "x" }).mockResolvedValueOnce({ id: "y" }).mockResolvedValueOnce(null);
    const res = await post(valid);
    expect(await res.json()).toEqual({ slug: "my-agent-3" });
  });

  it("copies rules, tools and notes from another agent", async () => {
    h.findUnique.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === "base" ? { rules: ["r1"], tools: ["t1"], toolNotes: { t1: "n" } } : null,
    );
    const res = await post({ ...valid, copyFrom: "base" });
    expect(res.status).toBe(201);
    expect(h.create.mock.calls[0][0].data).toMatchObject({ rules: ["r1"], tools: ["t1"], toolNotes: { t1: "n" } });
  });

  it("returns 404 when the agent to copy is missing", async () => {
    h.findUnique.mockResolvedValue(null);
    const res = await post({ ...valid, copyFrom: "ghost" });
    expect(res.status).toBe(404);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the role is too short", async () => {
    const res = await post({ ...valid, role: "short" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sentence/);
  });

  it("returns 400 when the name is empty", async () => {
    expect((await post({ ...valid, name: " " })).status).toBe(400);
  });

  it("falls back to the slug 'agent' for a name with no letters", async () => {
    h.findUnique.mockResolvedValue(null);
    const res = await post({ ...valid, name: "!!!" });
    expect(await res.json()).toEqual({ slug: "agent" });
  });
});
