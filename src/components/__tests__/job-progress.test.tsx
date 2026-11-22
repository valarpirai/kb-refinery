// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobProgress, type JobData } from ".././job-progress";

let live: ((e: { t: string; job?: string } | null) => void) | null = null;
vi.mock("@/lib/use-live", () => ({ useLive: (h: typeof live) => { live = h; } }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

/**
 * Build an item.
 * @param id item and article id
 * @param status item status
 * @param over fields to override
 */
const item = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id: `i-${id}`, status, message: null, failedStage: null,
  article: { id, title: `Article ${id}`, knowledgeBase: "KB" }, analysis: null, ...over,
});

const job = (over: Partial<JobData> = {}): JobData => ({
  id: "j1", status: "running", scope: "Docs import", articlesTotal: 4, findingsGenerated: 7, duplicatesFound: 2, errorMessage: null,
  items: [item("a", "completed", { analysis: { id: "an1", pipelineStage: "ready" } }), item("b", "analyzing"), item("c", "failed", { failedStage: "analyze", message: "Boom" }), item("d", "pending")],
  ...over,
});

describe("JobProgress", () => {
  beforeEach(() => {
    live = null;
    vi.unstubAllGlobals();
  });

  it("shows the title, status, progress and totals", () => {
    render(<JobProgress initial={job()} />);
    expect(screen.getByRole("heading", { name: "Docs import" })).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Articles finished" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByText("2 of 4 finished · 7 findings · 2 duplicate pair(s)")).toBeInTheDocument();
  });

  it("falls back to Job as the title and shows a job error", () => {
    render(<JobProgress initial={job({ scope: null, errorMessage: "Source unreachable" })} />);
    expect(screen.getByRole("heading", { name: "Job" })).toBeInTheDocument();
    expect(screen.getByText("Source unreachable")).toBeInTheDocument();
  });

  it("does not divide by zero with no articles", () => {
    render(<JobProgress initial={job({ articlesTotal: 0, items: [] })} />);
    expect(screen.getByText(/0 of 0 finished/)).toBeInTheDocument();
  });

  it("lists a count for each status that has items", () => {
    render(<JobProgress initial={job()} />);
    const counts = screen.getAllByRole("list")[0];
    expect(within(counts).getByText("Completed").closest("li")).toHaveTextContent("1");
    expect(within(counts).getByText("Failed").closest("li")).toHaveTextContent("1");
    expect(within(counts).queryByText("Skipped")).not.toBeInTheDocument();
  });

  it("links an article to its report only once the analysis exists", () => {
    render(<JobProgress initial={job()} />);
    expect(screen.getByRole("link", { name: "Article a" })).toHaveAttribute("href", "/analysis/an1");
    expect(screen.queryByRole("link", { name: "Article b" })).not.toBeInTheDocument();
    expect(screen.getByText("Article b")).toBeInTheDocument();
  });

  it("shows where a failed item stopped, with its error", () => {
    render(<JobProgress initial={job()} />);
    expect(screen.getByText(/Failed at Analyze/)).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart from Analyze" })).toBeEnabled();
  });

  it("says when a failed item has no recorded message and defaults to the convert stage", () => {
    render(<JobProgress initial={job({ items: [item("c", "failed")] })} />);
    expect(screen.getByText("No error message was recorded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart from Convert" })).toBeInTheDocument();
  });

  it("restarts a failed item from its stage and refetches the job", async () => {
    const updated = job({ items: [item("c", "analyzing")] });
    const f = vi.fn(async (url: string) => (url.includes("/restart") ? { status: 202, json: async () => ({}) } : { ok: true, json: async () => updated }));
    vi.stubGlobal("fetch", f);
    render(<JobProgress initial={job()} />);
    await userEvent.click(screen.getByRole("button", { name: "Restart from Analyze" }));
    expect(f).toHaveBeenCalledWith("/api/job-items/i-c/restart", expect.objectContaining({ body: JSON.stringify({ fromStage: "analyze" }) }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Restart from/ })).not.toBeInTheDocument());
    expect(f).toHaveBeenCalledWith("/api/jobs/j1", { cache: "no-store" });
  });

  it("shows the restart error under the row", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 409, json: async () => ({ error: "Already running" }) }));
    render(<JobProgress initial={job()} />);
    await userEvent.click(screen.getByRole("button", { name: "Restart from Analyze" }));
    expect(await screen.findByText("Already running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart from Analyze" })).toBeEnabled();
  });

  it("disables the restart button while restarting", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<JobProgress initial={job()} />);
    await userEvent.click(screen.getByRole("button", { name: "Restart from Analyze" }));
    expect(screen.getByRole("button", { name: "Restarting…" })).toBeDisabled();
  });

  it("refetches when the server signals this job, or on reconnect, but not for other jobs", async () => {
    const updated = job({ status: "completed", scope: "Updated scope" });
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
    vi.stubGlobal("fetch", f);
    render(<JobProgress initial={job()} />);
    act(() => live!({ t: "Job", job: "other" }));
    expect(f).not.toHaveBeenCalled();
    act(() => live!({ t: "Job", job: "j1" }));
    expect(await screen.findByRole("heading", { name: "Updated scope" })).toBeInTheDocument();
    act(() => live!(null));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it("keeps the last state when the refetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<JobProgress initial={job()} />);
    act(() => live!(null));
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Docs import" })).toBeInTheDocument();
  });
});
