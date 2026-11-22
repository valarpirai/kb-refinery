// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationData, ConversationItem } from "@/app/(app)/chat/types";
import { ChatShell } from "./chat-shell";

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params,
}));
vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default: ({ href, children, onClick, prefetch: _p }: { href: string; children: React.ReactNode; onClick?: () => void; prefetch?: boolean }) => (
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(); }}>{children}</a>
  ),
}));
vi.mock("@/lib/use-live", () => ({ useLive: () => {} }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("remark-gfm", () => ({ default: () => {} }));

const list: ConversationItem[] = [{ id: "c1", title: "VPN help", updatedAt: new Date().toISOString() }];

const conv: ConversationData = {
  id: "c1", title: "VPN help", agentSlug: "auto", comparisons: [],
  messages: [
    { id: "u1", conversationId: "c1", role: "user", content: "How to VPN?", status: "completed", toolCalls: [], error: null, traceId: null, createdAt: "2026-01-01T00:00:00Z" },
    { id: "a1", conversationId: "c1", role: "assistant", content: "Use the client.", status: "completed", toolCalls: [], error: null, traceId: null, createdAt: "2026-01-01T00:00:01Z" },
  ],
};

type Route = (url: string, init?: RequestInit) => { ok: boolean; body?: unknown } | undefined;

/**
 * Stub fetch with routes. Unknown urls answer not ok.
 * @param route returns a response for a url, or undefined
 */
function stubFetch(route: Route) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const r = route(url, init) ?? { ok: false };
    return { ok: r.ok, json: async () => r.body ?? {} };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const base: Route = (url) => {
  if (url === "/api/chat/status") return { ok: true, body: { tally: { original: 1, refined: 2, tie: 0, neither: 0 }, index: { indexed: 5, total: 8 } } };
  if (url === "/api/conversations/c1") return { ok: true, body: conv };
  if (url === "/api/conversations") return { ok: true, body: list };
};

describe("ChatShell", () => {
  beforeEach(() => {
    params = new URLSearchParams();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  it("shows the greeting, conversation list, and loads status", async () => {
    stubFetch(base);
    render(<ChatShell userName="Ada Lovelace" isAdmin={false} initialConversations={list} />);
    expect(screen.getByRole("heading", { name: "Hello, Ada" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "VPN help" })).toBeInTheDocument();
    expect(await screen.findByText("5 of 8 refined articles indexed")).toBeInTheDocument();
  });

  it("loads the conversation named in the URL", async () => {
    params = new URLSearchParams("c=c1");
    stubFetch(base);
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    expect(screen.getByText("Loading conversation…")).toBeInTheDocument();
    expect(await screen.findByText("Use the client.")).toBeInTheDocument();
    expect(screen.getByText("How to VPN?")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("VPN help");
  });

  it("stops loading when the conversation cannot be fetched", async () => {
    params = new URLSearchParams("c=gone");
    stubFetch(() => undefined);
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    await waitFor(() => expect(screen.queryByText("Loading conversation…")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Hello, Ada" })).toBeInTheDocument();
  });

  it("fills the composer from a suggestion without sending", async () => {
    const f = stubFetch(base);
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Which articles have the most open findings?" }));
    expect(screen.getByLabelText("Ask a question")).toHaveValue("Which articles have the most open findings?");
    expect(f.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("sends a new question, shows both messages and moves the URL to the new conversation", async () => {
    const f = stubFetch((url, init) => {
      if (url === "/api/agent/messages" && init?.method === "POST") return { ok: true, body: { conversationId: "c9", userMessageId: "u9", assistantMessageId: "a9" } };
      if (url === "/api/agent/messages/a9") return { ok: true, body: { id: "a9", status: "pending" } };
      return base(url, init);
    });
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={[]} />);
    await userEvent.type(screen.getByLabelText("Ask a question"), "Tell me about VPN{Enter}");
    expect(await screen.findByText("Tell me about VPN", { selector: "p" })).toBeInTheDocument();
    const post = f.mock.calls.find((c) => c[0] === "/api/agent/messages" && c[1]?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ text: "Tell me about VPN", agentSlug: "auto" });
    expect(replace).toHaveBeenCalledWith("/chat?c=c9", { scroll: false });
    expect(screen.getByLabelText("Ask a question")).toHaveValue("");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tell me about VPN");
    // The agent reply is still pending, so another send is blocked.
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  it("shows the server error and keeps the text when sending fails", async () => {
    stubFetch((url, init) => (url === "/api/agent/messages" && init?.method === "POST" ? { ok: false, body: { error: "Rate limited" } } : base(url, init)));
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={[]} />);
    await userEvent.type(screen.getByLabelText("Ask a question"), "Hello world{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limited");
    expect(screen.getByLabelText("Ask a question")).toHaveValue("Hello world");
  });

  it("reports a network failure when sending", async () => {
    stubFetch(base);
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("offline");
      const r = base(url, init) ?? { ok: false };
      return { ok: r.ok, json: async () => r.body ?? {} };
    });
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={[]} />);
    await userEvent.type(screen.getByLabelText("Ask a question"), "Hello world{Enter}");
    expect(await screen.findByText("Could not reach the server. Try again.")).toBeInTheDocument();
  });

  it("renames a conversation optimistically and sends PATCH", async () => {
    const f = stubFetch((url, init) => (init?.method === "PATCH" ? { ok: true } : base(url, init)));
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    await userEvent.click(screen.getByRole("button", { name: "Rename VPN help" }));
    const input = screen.getByLabelText("Conversation title");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    expect(await screen.findByRole("link", { name: "Renamed" })).toBeInTheDocument();
    expect(f).toHaveBeenCalledWith("/api/conversations/c1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Renamed" }) }));
  });

  it("puts the old title back and shows an error when rename fails", async () => {
    stubFetch((url, init) => (init?.method === "PATCH" ? { ok: false } : base(url, init)));
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    await userEvent.click(screen.getByRole("button", { name: "Rename VPN help" }));
    const input = screen.getByLabelText("Conversation title");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    expect(await screen.findByText("Could not rename the conversation.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "VPN help" })).toBeInTheDocument();
  });

  it("asks before deleting and does nothing when declined", async () => {
    const f = stubFetch(base);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete VPN help" }));
    expect(confirm).toHaveBeenCalledWith('Delete "VPN help" and all its questions? This cannot be undone.');
    expect(f.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);
  });

  it("deletes the open conversation and returns to /chat", async () => {
    params = new URLSearchParams("c=c1");
    const f = stubFetch((url, init) => {
      if (init?.method === "DELETE") return { ok: true };
      if (url === "/api/conversations") return { ok: true, body: [] };
      return base(url, init);
    });
    vi.stubGlobal("confirm", () => true);
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    await screen.findByText("Use the client.");
    await userEvent.click(screen.getByRole("button", { name: "Delete VPN help" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat", { scroll: false }));
    expect(f).toHaveBeenCalledWith("/api/conversations/c1", { method: "DELETE" });
    expect(screen.queryByRole("link", { name: "VPN help" })).not.toBeInTheDocument();
  });

  it("shows an error and keeps the conversation when delete fails", async () => {
    stubFetch((url, init) => (init?.method === "DELETE" ? { ok: false } : base(url, init)));
    vi.stubGlobal("confirm", () => true);
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete VPN help" }));
    expect(await screen.findByText("Could not delete the conversation.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "VPN help" })).toBeInTheDocument();
  });

  it("opens the drawer from the menu button and closes it with Escape", async () => {
    stubFetch(base);
    const { container } = render(<ChatShell userName="Ada" isAdmin={false} initialConversations={list} />);
    const root = container.querySelector(".chat-root")!;
    const menu = screen.getByRole("button", { name: "Open conversations" });
    expect(root).toHaveAttribute("data-drawer", "closed");
    await userEvent.click(menu);
    expect(root).toHaveAttribute("data-drawer", "open");
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(root).toHaveAttribute("data-drawer", "closed");
    expect(menu).toHaveFocus();
  });

  it("does not send a question shorter than 3 characters", async () => {
    const f = stubFetch(base);
    render(<ChatShell userName="Ada" isAdmin={false} initialConversations={[]} />);
    await userEvent.type(screen.getByLabelText("Ask a question"), "hi{Enter}");
    await act(async () => {});
    expect(f.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });
});
