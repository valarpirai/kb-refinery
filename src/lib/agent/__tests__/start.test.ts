import { describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/lib/queue", () => ({ AGENT_QUEUE: "agent-message", getBoss: vi.fn(async () => ({ send })) }));
vi.mock("@/lib/db", () => ({
  db: {
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    agent: { findUnique: vi.fn() },
    chatMessage: { create: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { startAgentTurn } from ".././start";

function setup() {
  vi.mocked(db.conversation.create).mockResolvedValue({ id: "c1" } as never);
  vi.mocked(db.agent.findUnique).mockResolvedValue({ id: "ag" } as never);
  vi.mocked(db.chatMessage.create).mockResolvedValueOnce({ id: "um" } as never).mockResolvedValueOnce({ id: "am" } as never);
}

describe("startAgentTurn", () => {
  it("starts a new conversation with the default agent and queues the reply", async () => {
    setup();
    const out = await startAgentTurn("u1", "hello");
    expect(out).toEqual({ conversationId: "c1", userMessageId: "um", assistantMessageId: "am" });
    expect(db.conversation.create).toHaveBeenCalledWith({ data: { userId: "u1", title: "hello", agentSlug: "refinery" } });
    expect(vi.mocked(db.chatMessage.create).mock.calls[0][0].data).toEqual({ conversationId: "c1", role: "user", content: "hello", status: "completed" });
    expect(vi.mocked(db.chatMessage.create).mock.calls[1][0].data).toEqual({ conversationId: "c1", role: "assistant", status: "pending" });
    expect(send).toHaveBeenCalledWith("agent-message", { assistantId: "am" });
  });

  it("shortens a long first message into the title", async () => {
    setup();
    await startAgentTurn("u1", "x".repeat(100));
    const title = (vi.mocked(db.conversation.create).mock.calls[0][0].data as { title: string }).title;
    expect(title).toBe(`${"x".repeat(57)}…`);
    expect(title).toHaveLength(58);
  });

  it("keeps a 60 character message whole", async () => {
    setup();
    await startAgentTurn("u1", "y".repeat(60));
    expect((vi.mocked(db.conversation.create).mock.calls[0][0].data as { title: string }).title).toBe("y".repeat(60));
  });

  it("uses a given title", async () => {
    setup();
    await startAgentTurn("u1", "hello", { title: "Upload: a" });
    expect((vi.mocked(db.conversation.create).mock.calls[0][0].data as { title: string }).title).toBe("Upload: a");
  });

  it("rejects an unknown agent", async () => {
    vi.mocked(db.agent.findUnique).mockResolvedValue(null);
    await expect(startAgentTurn("u1", "hi", { agentSlug: "ghost" })).rejects.toThrow("Agent not found");
    expect(db.conversation.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("allows auto without looking the agent up", async () => {
    setup();
    await startAgentTurn("u1", "hi", { agentSlug: "auto" });
    expect(db.agent.findUnique).not.toHaveBeenCalled();
    expect(vi.mocked(db.conversation.create).mock.calls[0][0].data).toMatchObject({ agentSlug: "auto" });
  });

  it("continues an existing conversation owned by the user", async () => {
    vi.mocked(db.conversation.findFirst).mockResolvedValue({ id: "c9" } as never);
    vi.mocked(db.chatMessage.create).mockResolvedValue({ id: "m" } as never);
    const out = await startAgentTurn("u1", "more", { conversationId: "c9" });
    expect(out.conversationId).toBe("c9");
    expect(db.conversation.findFirst).toHaveBeenCalledWith({ where: { id: "c9", userId: "u1" }, select: { id: true } });
    expect(db.conversation.create).not.toHaveBeenCalled();
    expect(db.conversation.update).toHaveBeenCalledWith({ where: { id: "c9" }, data: { updatedAt: expect.any(Date) } });
  });

  it("rejects a conversation that is not the user's", async () => {
    vi.mocked(db.conversation.findFirst).mockResolvedValue(null);
    await expect(startAgentTurn("u1", "x", { conversationId: "c9" })).rejects.toThrow("Conversation not found");
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });
});
