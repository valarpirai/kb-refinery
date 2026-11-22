// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "@/app/(app)/chat/types";
import { ChatSidebar } from "./chat-sidebar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default: ({ href, children, onClick, prefetch: _p, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(e); }} {...rest}>{children}</a>
  ),
}));

const tally = { original: 0, refined: 0, tie: 0, neither: 0 };

/**
 * Render with defaults.
 * @param over props to override
 */
function setup(over: Partial<React.ComponentProps<typeof ChatSidebar>> = {}) {
  const props = { conversations: [] as ConversationItem[], activeId: null, tally, index: null, onNavigate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), ...over };
  render(<ChatSidebar {...props} />);
  return props;
}

/**
 * ISO time some days before now.
 * @param days how many days ago
 */
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("ChatSidebar", () => {
  it("says when there are no conversations", () => {
    setup();
    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
  });

  it("groups conversations by recency and skips empty groups", () => {
    setup({
      conversations: [
        { id: "1", title: "Now", updatedAt: new Date().toISOString() },
        { id: "2", title: "Last week", updatedAt: ago(4) },
        { id: "3", title: "Ancient", updatedAt: ago(40) },
      ],
    });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Today", "Previous 7 days", "Older"]);
  });

  it("links each conversation and marks the active one", () => {
    setup({ conversations: [{ id: "c1", title: "VPN", updatedAt: ago(0) }, { id: "c2", title: "Mail", updatedAt: ago(0) }], activeId: "c2" });
    expect(screen.getByRole("link", { name: "VPN" })).toHaveAttribute("href", "/chat?c=c1");
    expect(screen.getByRole("link", { name: "Mail" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "VPN" })).not.toHaveAttribute("aria-current");
  });

  it("calls onNavigate when New chat is clicked", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("link", { name: "New chat" }));
    expect(p.onNavigate).toHaveBeenCalled();
  });

  it("deletes through onDelete", async () => {
    const p = setup({ conversations: [{ id: "c1", title: "VPN", updatedAt: ago(0) }] });
    await userEvent.click(screen.getByRole("button", { name: "Delete VPN" }));
    expect(p.onDelete).toHaveBeenCalledWith("c1");
  });

  it("renames on Enter with a trimmed title", async () => {
    const p = setup({ conversations: [{ id: "c1", title: "VPN", updatedAt: ago(0) }] });
    await userEvent.click(screen.getByRole("button", { name: "Rename VPN" }));
    const input = screen.getByLabelText("Conversation title");
    expect(input).toHaveValue("VPN");
    await userEvent.clear(input);
    await userEvent.type(input, "  New name {Enter}");
    expect(p.onRename).toHaveBeenCalledWith("c1", "New name");
    expect(screen.queryByLabelText("Conversation title")).not.toBeInTheDocument();
  });

  it("does not rename on Escape, an empty title, or an unchanged title", async () => {
    const p = setup({ conversations: [{ id: "c1", title: "VPN", updatedAt: ago(0) }] });
    await userEvent.click(screen.getByRole("button", { name: "Rename VPN" }));
    await userEvent.type(screen.getByLabelText("Conversation title"), "x{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Rename VPN" }));
    await userEvent.clear(screen.getByLabelText("Conversation title"));
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Rename VPN" }));
    await userEvent.keyboard("{Enter}");
    expect(p.onRename).not.toHaveBeenCalled();
  });

  it("shows index status and verdict totals", () => {
    setup({ index: { indexed: 3, total: 10 }, tally: { refined: 4, original: 1, tie: 2, neither: 0 } });
    expect(screen.getByText("3 of 10 refined articles indexed")).toBeInTheDocument();
    const dl = screen.getByLabelText("Your verdicts");
    expect(dl).toHaveTextContent("Refined better4");
    expect(dl).toHaveTextContent("Original better1");
    expect(screen.queryByText("No verdicts yet.")).not.toBeInTheDocument();
  });

  it("shows loading and no-verdicts text before data arrives", () => {
    setup();
    expect(screen.getByText("Loading index status…")).toBeInTheDocument();
    expect(screen.getByText("No verdicts yet.")).toBeInTheDocument();
  });
});
