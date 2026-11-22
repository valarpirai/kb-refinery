import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/agent/start", () => ({ startAgentTurn: h.start }));

import { POST } from ".././route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/agent/messages", () => {
  beforeEach(() => h.getUser.mockResolvedValue({ id: "u1", role: "user" }));

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post({ text: "hi" })).status).toBe(401);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("starts a turn and returns the ids with 201", async () => {
    h.start.mockResolvedValue({ conversationId: "c1", messageId: "m1" });
    const res = await post({ text: "  hello  ", conversationId: "c1", agentSlug: "refiner" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ conversationId: "c1", messageId: "m1" });
    expect(h.start).toHaveBeenCalledWith("u1", "hello", { conversationId: "c1", agentSlug: "refiner" });
  });

  it("returns 400 for empty text", async () => {
    const res = await post({ text: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Say something");
  });

  it("returns 400 for text over 4000 characters", async () => {
    expect((await post({ text: "a".repeat(4001) })).status).toBe(400);
  });

  it("returns 400 for a body that is not JSON", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("returns 404 with the message when the turn cannot start", async () => {
    h.start.mockRejectedValue(new Error("Conversation not found"));
    const res = await post({ text: "hi" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Conversation not found" });
  });
});
