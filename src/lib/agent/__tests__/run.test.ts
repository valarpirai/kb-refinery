import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentCtor = vi.fn();
let events: unknown[] = [];
let streamError: Error | null = null;
const stream = vi.fn();
const span = { setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn(), spanContext: () => ({ traceId: "trace-1" }) };

vi.mock("@strands-agents/sdk", () => ({
  Agent: class {
    constructor(o: unknown) {
      agentCtor(o);
    }
    stream(input: string) {
      stream(input);
      const evs = events;
      const err = streamError;
      return (async function* () {
        for (const e of evs) yield e;
        if (err) throw err;
      })();
    }
  },
}));
vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: { getTracer: () => ({ startActiveSpan: (_n: string, fn: (s: typeof span) => Promise<void>) => fn(span) }) },
}));
vi.mock(".././model", () => ({ makeModel: vi.fn(() => "MODEL") }));
vi.mock(".././router", () => ({ routeAgent: vi.fn(async () => "routed") }));
vi.mock(".././tools", () => ({ buildTools: vi.fn(() => ["TOOLS"]) }));
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    agent: { findUnique: vi.fn() },
    conversation: { update: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { routeAgent } from ".././router";
import { buildTools } from ".././tools";
import { runAgentMessage } from ".././run";

const msgUpdate = () => vi.mocked(db.chatMessage.update);
const lastUpdate = () => msgUpdate().mock.calls.at(-1)![0].data as Record<string, unknown>;

const created = new Date("2026-01-01T00:00:10Z");
const user = (content: string, i = 0) => ({ id: `u${i}`, role: "user", content, status: "completed" });
const assistant = (content: string, i = 0) => ({ id: `a${i}`, role: "assistant", content, status: "completed" });
const delta = (text: string) => ({ type: "modelStreamUpdateEvent", event: { delta: { type: "textDelta", text } } });

function setup(opts: { agentSlug?: string; prior?: unknown[]; config?: unknown } = {}) {
  vi.mocked(db.chatMessage.findUnique).mockResolvedValue({
    id: "asst", role: "assistant", conversationId: "c1", createdAt: created,
    conversation: { userId: "u1", agentSlug: opts.agentSlug ?? "refinery" },
  } as never);
  vi.mocked(db.chatMessage.findMany).mockResolvedValue((opts.prior ?? [user("Q")]) as never);
  vi.mocked(db.agent.findUnique).mockResolvedValue((opts.config === undefined ? { name: "Refinery", prompt: "PROMPT", tools: ["get_stats"] } : opts.config) as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  events = [];
  streamError = null;
});
afterEach(() => vi.useRealTimers());

describe("runAgentMessage guards", () => {
  it("does nothing when the message is missing or is not an assistant message", async () => {
    vi.mocked(db.chatMessage.findUnique).mockResolvedValue(null);
    await runAgentMessage("x");
    vi.mocked(db.chatMessage.findUnique).mockResolvedValue({ role: "user" } as never);
    await runAgentMessage("x");
    expect(msgUpdate()).not.toHaveBeenCalled();
  });

  it("fails the message when the last prior message is not from the user", async () => {
    setup({ prior: [user("Q"), assistant("A", 1)] });
    await runAgentMessage("asst");
    expect(msgUpdate()).toHaveBeenCalledWith({ where: { id: "asst" }, data: { status: "failed", error: "No question to answer" } });
    expect(agentCtor).not.toHaveBeenCalled();
  });

  it("fails the message when there are no prior messages", async () => {
    setup({ prior: [] });
    await runAgentMessage("asst");
    expect(lastUpdate()).toMatchObject({ status: "failed", error: "No question to answer" });
  });

  it("queries only earlier completed messages in this conversation", async () => {
    setup();
    await runAgentMessage("asst");
    expect(db.chatMessage.findMany).toHaveBeenCalledWith({
      where: { conversationId: "c1", createdAt: { lt: created }, status: "completed" },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("runAgentMessage success", () => {
  it("streams text, marks streaming with the trace id, then completes", async () => {
    setup();
    events = [delta("Hel"), delta("lo "), delta("world")];
    await runAgentMessage("asst");
    expect(msgUpdate().mock.calls[0][0].data).toEqual({ status: "streaming", traceId: "trace-1" });
    expect(stream).toHaveBeenCalledWith("Q");
    expect(lastUpdate()).toMatchObject({ status: "completed", content: "Hello world", toolCalls: [] });
    expect(db.conversation.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { updatedAt: expect.any(Date) } });
    expect(span.end).toHaveBeenCalledOnce();
    expect(span.setAttribute).toHaveBeenCalledWith("kb.message_id", "asst");
  });

  it("builds the agent from the stored config and passes tools for the user", async () => {
    setup();
    await runAgentMessage("asst");
    expect(buildTools).toHaveBeenCalledWith({ userId: "u1" }, ["get_stats"]);
    expect(agentCtor).toHaveBeenCalledWith(expect.objectContaining({ name: "Refinery", systemPrompt: "PROMPT", model: "MODEL", tools: ["TOOLS"], printer: false }));
    expect(msgUpdate()).toHaveBeenCalledWith({ where: { id: "asst" }, data: { agentSlug: "refinery" } });
    expect(routeAgent).not.toHaveBeenCalled();
  });

  it("passes at most the last 12 earlier messages as history, excluding the question", async () => {
    const prior = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? user(`m${i}`, i) : assistant(`m${i}`, i)));
    prior.push(user("final", 99));
    setup({ prior });
    await runAgentMessage("asst");
    const history = agentCtor.mock.calls[0][0].messages as { role: string; content: { text: string }[] }[];
    expect(history).toHaveLength(12);
    expect(history[0].content[0].text).toBe("m3");
    expect(history.at(-1)!.content[0].text).toBe("m14");
    expect(stream).toHaveBeenCalledWith("final");
  });

  it("uses the router for auto conversations and saves the pick", async () => {
    setup({ agentSlug: "auto" });
    await runAgentMessage("asst");
    expect(routeAgent).toHaveBeenCalledWith("Q");
    expect(msgUpdate()).toHaveBeenCalledWith({ where: { id: "asst" }, data: { agentSlug: "routed" } });
    expect(db.agent.findUnique).toHaveBeenCalledWith({ where: { slug: "routed" } });
  });

  it("uses a fallback text when the agent says nothing", async () => {
    setup();
    events = [delta("   ")];
    await runAgentMessage("asst");
    expect(lastUpdate()).toMatchObject({ status: "completed", content: "I could not put together an answer. Try asking again." });
  });

  it("ignores empty text deltas and unrelated events", async () => {
    setup();
    events = [delta(""), { type: "other" }, { type: "modelStreamUpdateEvent", event: { delta: { type: "toolUseDelta", text: "no" } } }, delta("ok")];
    await runAgentMessage("asst");
    expect(lastUpdate().content).toBe("ok");
  });

  it("throttles text flushes to every 400 ms", async () => {
    setup();
    events = [delta("a"), delta("b")];
    await runAgentMessage("asst");
    // streaming marker, one flush for the first delta, then the final update.
    const contentWrites = msgUpdate().mock.calls.filter((c) => "content" in (c[0].data as object));
    expect(contentWrites).toHaveLength(2);
    expect(contentWrites[0][0].data).toMatchObject({ content: "a" });
  });

  it("records a tool call from start to result", async () => {
    setup();
    // The calls array is mutated later, so copy it as each write happens.
    const writes: { status: string }[][] = [];
    msgUpdate().mockImplementation((async (a: { data: { toolCalls?: unknown } }) => {
      if (a.data.toolCalls) writes.push(JSON.parse(JSON.stringify(a.data.toolCalls)));
    }) as never);
    events = [
      { type: "beforeToolCallEvent", toolUse: { name: "get_stats", toolUseId: "t1", input: { a: 1 } } },
      { type: "toolResultEvent", result: { toolUseId: "t1", status: "success", content: [{ text: "foo" }, { text: "bar" }] } },
      delta("done"),
    ];
    await runAgentMessage("asst");
    const calls = lastUpdate().toolCalls as Record<string, unknown>[];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "t1", name: "get_stats", input: { a: 1 }, status: "success", output: "foobar" });
    expect(calls[0].startedAt).toBeTruthy();
    expect(calls[0].endedAt).toBeTruthy();
    // The running state was saved before the result arrived.
    expect(writes.some((w) => w[0]?.status === "running")).toBe(true);
  });

  it("reads a result wrapped in toolResult and marks non-success as error", async () => {
    setup();
    events = [
      { type: "beforeToolCallEvent", toolUse: { name: "t", toolUseId: "t1", input: {} } },
      { type: "toolResultEvent", result: { toolResult: { toolUseId: "t1", status: "error", content: [{ text: "bad" }] } } },
    ];
    await runAgentMessage("asst");
    expect((lastUpdate().toolCalls as { status: string; output: string }[])[0]).toMatchObject({ status: "error", output: "bad" });
  });

  it("cuts tool output to 2000 characters", async () => {
    setup();
    events = [
      { type: "beforeToolCallEvent", toolUse: { name: "t", toolUseId: "t1", input: {} } },
      { type: "toolResultEvent", result: { toolUseId: "t1", status: "success", content: [{ text: "x".repeat(5000) }] } },
    ];
    await runAgentMessage("asst");
    expect((lastUpdate().toolCalls as { output: string }[])[0].output).toHaveLength(2000);
  });

  it("ignores a tool result with no matching call", async () => {
    setup();
    events = [{ type: "toolResultEvent", result: { toolUseId: "ghost", status: "success", content: [] } }];
    await runAgentMessage("asst");
    expect(lastUpdate()).toMatchObject({ status: "completed", toolCalls: [] });
  });
});

describe("runAgentMessage errors", () => {
  it("fails with a clear message when the agent does not exist", async () => {
    setup({ config: null });
    await runAgentMessage("asst");
    expect(lastUpdate()).toMatchObject({ status: "failed", error: expect.stringContaining('Agent "refinery" does not exist') });
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: expect.any(String) });
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("fails when the agent has a blank prompt", async () => {
    setup({ config: { name: "R", prompt: "  ", tools: [] } });
    await runAgentMessage("asst");
    expect(lastUpdate()).toMatchObject({ status: "failed", error: expect.stringContaining("has no prompt yet") });
    expect(agentCtor).not.toHaveBeenCalled();
  });

  it("keeps partial text and tool calls when the stream throws", async () => {
    setup();
    events = [delta("part"), { type: "beforeToolCallEvent", toolUse: { name: "t", toolUseId: "t1", input: {} } }];
    streamError = new Error("e".repeat(700));
    await runAgentMessage("asst");
    const data = lastUpdate();
    expect(data.status).toBe("failed");
    expect(data.content).toBe("part");
    expect((data.error as string).length).toBe(500);
    expect((data.toolCalls as unknown[]).length).toBe(1);
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledOnce();
  });
});
