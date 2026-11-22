import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  chunkCount: vi.fn(),
  convFind: vi.fn(),
  convUpdate: vi.fn(),
  convCreate: vi.fn(),
  cmpCreate: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/db", () => ({
  db: { chunk: { count: h.chunkCount }, conversation: { findFirst: h.convFind, update: h.convUpdate, create: h.convCreate }, comparison: { create: h.cmpCreate } },
}));
vi.mock("@/lib/queue", () => ({ ANSWER_QUEUE: "answer-arm", getBoss: async () => ({ send: h.send }) }));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/compare", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.chunkCount.mockResolvedValue(5);
    h.convCreate.mockResolvedValue({ id: "c-new" });
    h.cmpCreate.mockResolvedValue({ id: "cmp1", arms: [{ id: "arm1" }, { id: "arm2" }] });
  });

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post({ query: "how do I reset?" })).status).toBe(401);
  });

  it("starts a new conversation, creates both arms and queues them", async () => {
    const res = await post({ query: "  how do I reset?  " });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "cmp1", conversationId: "c-new" });
    expect(h.convCreate).toHaveBeenCalledWith({ data: { userId: "u1", title: "how do I reset?" } });
    expect(h.cmpCreate.mock.calls[0][0].data.arms).toEqual({ create: [{ variant: "original" }, { variant: "refined" }] });
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenCalledWith("answer-arm", { armId: "arm1" });
    expect(h.send).toHaveBeenCalledWith("answer-arm", { armId: "arm2" });
  });

  it("truncates long titles to 60 characters", async () => {
    await post({ query: "q".repeat(100) });
    const title = h.convCreate.mock.calls[0][0].data.title as string;
    expect(title).toHaveLength(58);
    expect(title.endsWith("…")).toBe(true);
  });

  it("adds to an existing conversation owned by the user", async () => {
    h.convFind.mockResolvedValue({ id: "c1" });
    const res = await post({ query: "another one", conversationId: "c1" });
    expect(res.status).toBe(201);
    expect((await res.json()).conversationId).toBe("c1");
    expect(h.convFind).toHaveBeenCalledWith({ where: { id: "c1", userId: "u1" }, select: { id: true } });
    expect(h.convUpdate).toHaveBeenCalled();
    expect(h.convCreate).not.toHaveBeenCalled();
  });

  it("returns 404 for a conversation the user does not own", async () => {
    h.convFind.mockResolvedValue(null);
    const res = await post({ query: "another one", conversationId: "other" });
    expect(res.status).toBe(404);
    expect(h.cmpCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for a question under 3 characters", async () => {
    const res = await post({ query: " hi " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ask a longer question");
  });

  it("returns 400 for a question over 1000 characters", async () => {
    expect((await post({ query: "q".repeat(1001) })).status).toBe(400);
  });

  it("returns 409 when nothing is indexed", async () => {
    h.chunkCount.mockResolvedValue(0);
    const res = await post({ query: "how do I reset?" });
    expect(res.status).toBe(409);
    expect(h.cmpCreate).not.toHaveBeenCalled();
  });
});
