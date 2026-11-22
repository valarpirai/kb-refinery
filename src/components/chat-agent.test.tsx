// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageData } from "@/app/(app)/chat/types";
import { ChatAgentMessage, ChatUserMessage, isAgentBusy } from "./chat-agent";

let liveHandler: ((e: { t: string; id?: string } | null) => void) | null = null;
let liveActive = true;
vi.mock("@/lib/use-live", () => ({
  useLive: (h: typeof liveHandler, active = true) => {
    liveHandler = h;
    liveActive = active;
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <div data-testid="md">{children}</div> }));
vi.mock("remark-gfm", () => ({ default: () => {} }));

/**
 * Build a message.
 * @param over fields to override
 */
const msg = (over: Partial<ChatMessageData> = {}): ChatMessageData => ({
  id: "m1", conversationId: "c1", role: "assistant", content: "", status: "completed", toolCalls: [], error: null, traceId: null, createdAt: "2026-01-01", ...over,
});

const props = { isAdmin: false, fresh: false, onChange: vi.fn(), onRetry: vi.fn(), retryDisabled: false };

describe("isAgentBusy", () => {
  it("is true only for pending or streaming assistant messages", () => {
    expect(isAgentBusy(msg({ status: "pending" }))).toBe(true);
    expect(isAgentBusy(msg({ status: "streaming" }))).toBe(true);
    expect(isAgentBusy(msg({ status: "completed" }))).toBe(false);
    expect(isAgentBusy(msg({ status: "failed" }))).toBe(false);
    expect(isAgentBusy(msg({ role: "user", status: "pending" }))).toBe(false);
  });
});

describe("ChatUserMessage", () => {
  it("shows what the person asked", () => {
    render(<ChatUserMessage msg={msg({ role: "user", content: "What is new?" })} fresh={false} />);
    expect(screen.getByText("What is new?")).toBeInTheDocument();
  });
});

describe("ChatAgentMessage", () => {
  beforeEach(() => {
    liveHandler = null;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => msg({ content: "done", status: "completed" }) }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the answer as markdown and a ready status", () => {
    render(<ChatAgentMessage {...props} msg={msg({ content: "**Hi**" })} />);
    expect(screen.getByTestId("md")).toHaveTextContent("**Hi**");
    expect(screen.getByText("Answer ready.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows typing dots while busy with no text, and fetches once at start", async () => {
    render(<ChatAgentMessage {...props} msg={msg({ status: "pending" })} />);
    expect(screen.getByText("Writing the answer…")).toBeInTheDocument();
    expect(screen.getByText("Working…")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/agent/messages/m1", { cache: "no-store" });
    await act(async () => {});
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ content: "done" }));
  });

  it("only listens to live events while busy", () => {
    const { rerender } = render(<ChatAgentMessage {...props} msg={msg({ status: "streaming", content: "x" })} />);
    expect(liveActive).toBe(true);
    rerender(<ChatAgentMessage {...props} msg={msg({ status: "completed", content: "x" })} />);
    expect(liveActive).toBe(false);
  });

  it("fetches again after a change event for this message, throttled", async () => {
    vi.useFakeTimers();
    render(<ChatAgentMessage {...props} msg={msg({ status: "streaming", content: "x" })} />);
    await act(async () => {});
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => liveHandler!({ t: "ChatMessage", id: "m1" }));
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1);
  });

  it("ignores events for other messages but fetches on reconnect", async () => {
    vi.useFakeTimers();
    render(<ChatAgentMessage {...props} msg={msg({ status: "streaming", content: "x" })} />);
    await act(async () => {});
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => liveHandler!({ t: "ChatMessage", id: "other" }));
    act(() => liveHandler!({ t: "Job", id: "m1" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    act(() => liveHandler!(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1);
  });

  it("keeps working when the fetch fails", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    render(<ChatAgentMessage {...props} msg={msg({ status: "pending" })} />);
    await act(async () => {});
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Working…")).toBeInTheDocument();
  });

  it("lists tool calls with friendly names and states, and input and output", async () => {
    const toolCalls = [
      { id: "t1", name: "get_stats", status: "success" as const, input: { a: 1 }, output: { n: 5 } },
      { id: "t2", name: "mystery_tool", status: "running" as const, input: { q: "x" } },
      { id: "t3", name: "search_articles", status: "error" as const, input: {}, output: "boom" },
    ];
    render(<ChatAgentMessage {...props} msg={msg({ toolCalls, content: "ok" })} />);
    expect(screen.getByText("Looked up statistics")).toBeInTheDocument();
    expect(screen.getByText("mystery_tool")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    const details = document.querySelectorAll("details");
    expect(details[0].textContent).toContain('"n": 5');
    expect(details[1].textContent).not.toContain("Output");
    expect(details[2].textContent).toContain("boom");
  });

  it("shows a failure with the error and a retry that calls onRetry", async () => {
    const onRetry = vi.fn();
    render(<ChatAgentMessage {...props} onRetry={onRetry} msg={msg({ status: "failed", error: "Model timed out" })} />);
    expect(screen.getByText("Model timed out")).toBeInTheDocument();
    expect(screen.getByText("The agent failed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledWith("m1");
  });

  it("uses a default failure text and can disable retry", () => {
    render(<ChatAgentMessage {...props} retryDisabled msg={msg({ status: "failed" })} />);
    expect(screen.getByText("The agent could not finish.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  });

  it("shows the trace link to admins only", () => {
    const m = msg({ traceId: "tr1", content: "x" });
    const { rerender } = render(<ChatAgentMessage {...props} msg={m} />);
    expect(screen.queryByRole("link", { name: "View trace" })).not.toBeInTheDocument();
    rerender(<ChatAgentMessage {...props} isAdmin msg={m} />);
    expect(screen.getByRole("link", { name: "View trace" })).toHaveAttribute("href", "/traces/tr1");
  });
});
