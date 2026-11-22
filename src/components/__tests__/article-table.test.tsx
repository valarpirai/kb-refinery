// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArticleTable, type ArticleRow } from ".././article-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock(".././article-delete-button.css", () => ({}));
vi.mock("@/components/article-tags", () => ({ ArticleTags: ({ articleId }: { articleId: string }) => <span data-testid={`tags-${articleId}`} /> }));

const steps = (["import", "convert", "analyze", "enrich", "rewrite", "ready"] as const).map((key) => ({ key, label: key, state: "pending" as const }));

/**
 * Build a row.
 * @param id article id
 * @param over fields to override
 */
const row = (id: string, over: Partial<ArticleRow> = {}): ArticleRow => ({
  id, title: `Title ${id}`, knowledgeBase: "KB One", stage: "ready", rawScore: 40, rewrittenScore: 90, openFindings: 3, tags: [], updatedAt: "2026-03-04T10:00:00Z", steps, ...over,
});

describe("ArticleTable", () => {
  it("shows each article with link, knowledge base, stage, scores and findings", () => {
    render(<ArticleTable rows={[row("a")]} />);
    expect(screen.getByRole("link", { name: "Title a" })).toHaveAttribute("href", "/articles/a");
    expect(screen.getByText("KB One")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByLabelText("Raw 40, rewritten 90")).toHaveTextContent("40 → 90");
    expect(screen.getByTestId("tags-a")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Pipeline/ })).toBeInTheDocument();
  });

  it("shows placeholders for missing values", () => {
    render(<ArticleTable rows={[row("a", { knowledgeBase: null, stage: null, rawScore: null, rewrittenScore: null })]} />);
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("Not refined")).toBeInTheDocument();
    expect(screen.getByLabelText("Raw none, rewritten none")).toHaveTextContent("– → –");
  });

  it("shows no action bar until a row is selected, then a count", async () => {
    render(<ArticleTable rows={[row("a"), row("b")]} />);
    expect(screen.queryByRole("button", { name: /Refine selected/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Select Title a"));
    expect(screen.getByRole("button", { name: "Refine selected (1)" })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Select Title b"));
    expect(screen.getByRole("button", { name: "Refine selected (2)" })).toBeInTheDocument();
  });

  it("select all picks every row, and is indeterminate for a partial selection", async () => {
    render(<ArticleTable rows={[row("a"), row("b")]} />);
    const all = screen.getByLabelText("Select all on this page") as HTMLInputElement;
    await userEvent.click(screen.getByLabelText("Select Title a"));
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
    await userEvent.click(all);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    expect(screen.getByRole("button", { name: "Refine selected (2)" })).toBeInTheDocument();
    await userEvent.click(all);
    expect(screen.queryByRole("button", { name: /Refine selected/ })).not.toBeInTheDocument();
  });

  it("clear selection unchecks everything", async () => {
    render(<ArticleTable rows={[row("a")]} />);
    await userEvent.click(screen.getByLabelText("Select Title a"));
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByLabelText("Select Title a")).not.toBeChecked();
  });

  it("starts a job for the selection and opens it", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "j1" }) });
    vi.stubGlobal("fetch", f);
    render(<ArticleTable rows={[row("a"), row("b")]} />);
    await userEvent.click(screen.getByLabelText("Select Title b"));
    await userEvent.click(screen.getByRole("button", { name: "Refine selected (1)" }));
    expect(f).toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ body: JSON.stringify({ articleIds: ["b"] }) }));
    expect(push).toHaveBeenCalledWith("/jobs/j1");
  });

  it("shows the error and keeps the selection when the job cannot start", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Queue full" }) }));
    render(<ArticleTable rows={[row("a")]} />);
    await userEvent.click(screen.getByLabelText("Select Title a"));
    await userEvent.click(screen.getByRole("button", { name: "Refine selected (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Queue full");
    expect(screen.getByRole("button", { name: "Refine selected (1)" })).toBeEnabled();
  });

  it("shows Starting while the job request runs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ArticleTable rows={[row("a")]} />);
    await userEvent.click(screen.getByLabelText("Select Title a"));
    await userEvent.click(screen.getByRole("button", { name: "Refine selected (1)" }));
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  });

  it("offers bulk delete only to people who can delete", async () => {
    const { unmount } = render(<ArticleTable rows={[row("a")]} />);
    await userEvent.click(screen.getByLabelText("Select Title a"));
    expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
    unmount();
    render(<ArticleTable rows={[row("a")]} canDelete />);
    await userEvent.click(screen.getByLabelText("Select Title a"));
    const status = screen.getByRole("status");
    expect(within(status).getByRole("button", { name: "Delete (1)" })).toBeInTheDocument();
  });
});
