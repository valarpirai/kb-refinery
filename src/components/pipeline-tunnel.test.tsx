// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStatus, PipelineStep, StepState } from "@/lib/pipeline/status";
import { PipelineTunnel } from "./pipeline-tunnel";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a> }));
vi.mock("./pipeline.css", () => ({}));

let live: ((e: { t: string; article?: string } | null) => void) | null = null;
vi.mock("@/lib/use-live", () => ({ useLive: (h: typeof live) => { live = h; } }));

const KEYS = ["import", "convert", "analyze", "enrich", "rewrite", "ready"] as const;
const LABELS = ["Imported", "Convert", "Analyze", "Enrich", "Rewrite", "Ready"];

/**
 * Build a status from six step states.
 * @param states state per step
 * @param over fields to override
 */
function status(states: StepState[], over: Partial<PipelineStatus> = {}): PipelineStatus {
  const steps: PipelineStep[] = states.map((state, i) => ({ key: KEYS[i], label: LABELS[i], state }));
  return { articleId: "a1", analysisId: null, steps, running: false, item: null, restartFrom: [], ...over };
}

const failed = () => status(["done", "done", "failed", "pending", "pending", "pending"], {
  restartFrom: ["convert", "analyze"],
  item: { id: "item1", status: "failed", failedStage: "analyze", message: "Model timed out", restarts: 2, jobId: "job1", updatedAt: "2026-01-01" },
});

/**
 * Route fetch calls by url.
 * @param routes map of url to response, or a function
 */
function stubFetch(routes: Record<string, unknown>) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const v = typeof hit[1] === "function" ? (hit[1] as (u: string, i?: RequestInit) => unknown)(url, init) : hit[1];
    return v as { ok: boolean; status?: number; json: () => Promise<unknown> };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("PipelineTunnel", () => {
  beforeEach(() => {
    live = null;
    vi.unstubAllGlobals();
  });

  it("lists the six stages with their state in words", () => {
    render(<PipelineTunnel articleId="a1" initial={status(["done", "done", "active", "queued", "pending", "pending"])} />);
    const list = screen.getByRole("list", { name: "Pipeline stages" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent("ImportedDone");
    expect(items[2]).toHaveTextContent("AnalyzeRunning");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[3]).toHaveTextContent("EnrichQueued");
    expect(items[4]).toHaveTextContent("RewriteWaiting");
  });

  it("sums up progress in a sentence for each situation", () => {
    const first = render(<PipelineTunnel articleId="a1" initial={status(["done", "done", "active", "pending", "pending", "pending"])} />);
    expect(screen.getByRole("status")).toHaveTextContent("Currently analyzing. 1 of 5 stages done.");
    first.unmount();
    render(<PipelineTunnel articleId="a1" initial={status(["done", "done", "queued", "pending", "pending", "pending"])} />);
    expect(screen.getByRole("status")).toHaveTextContent("Analyze is queued.");
  });

  it("says finished, failed and not started", () => {
    const { unmount } = render(<PipelineTunnel articleId="a1" initial={status(["done", "done", "done", "done", "done", "done"])} />);
    expect(screen.getByRole("status")).toHaveTextContent("Pipeline finished. Ready.");
    unmount();
    const f = render(<PipelineTunnel articleId="a1" initial={failed()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Failed at Analyze. 1 of 5 stages done.");
    f.unmount();
    render(<PipelineTunnel articleId="a1" initial={status(["done", "pending", "pending", "pending", "pending", "pending"])} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not started. 0 of 5 stages done.");
  });

  it("shows time, scores and size under a finished step, and leaves out unknown parts", () => {
    const s = status(["done", "done", "done", "pending", "pending", "pending"]);
    s.steps[2].detail = { durationMs: 2500, mechanical: 80, model: null, words: 1200, bytes: 2048 };
    s.steps[3].detail = { durationMs: 1000, mechanical: null, model: null, words: null, bytes: null };
    render(<PipelineTunnel articleId="a1" initial={s} />);
    expect(screen.getByText("2.5 s")).toBeInTheDocument();
    expect(screen.getByText("Score 80 mech · – model")).toBeInTheDocument();
    expect(screen.getByText("1,200 words · 2.0 KB")).toBeInTheDocument();
    // A pending step shows no facts even when it has detail.
    expect(screen.queryByText("1.0 s")).not.toBeInTheDocument();
  });

  it("shows no restart panel for a healthy article", () => {
    render(<PipelineTunnel articleId="a1" initial={status(["done", "done", "active", "pending", "pending", "pending"])} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the failure with its message, restart count and job link", () => {
    render(<PipelineTunnel articleId="a1" initial={failed()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Stage Analyze failed");
    expect(within(alert).getByLabelText("Error message")).toHaveTextContent("Model timed out");
    expect(alert).toHaveTextContent("Restarted 2 times.");
    expect(within(alert).getByRole("link", { name: "View job" })).toHaveAttribute("href", "/jobs/job1");
    expect(within(alert).getByRole("button", { name: "Restart from Analyze" })).toBeEnabled();
  });

  it("restarts from the failed stage and shows the stages as queued at once", async () => {
    const f = stubFetch({ "/restart": { ok: true, status: 202, json: async () => ({}) } });
    render(<PipelineTunnel articleId="a1" initial={failed()} />);
    await userEvent.click(screen.getByRole("button", { name: "Restart from Analyze" }));
    expect(f).toHaveBeenCalledWith("/api/job-items/item1/restart", expect.objectContaining({ body: JSON.stringify({ fromStage: "analyze" }) }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    const items = within(screen.getByRole("list", { name: "Pipeline stages" })).getAllByRole("listitem");
    expect(items[2]).toHaveTextContent("AnalyzeQueued");
    expect(items[1]).toHaveTextContent("ConvertDone");
    expect(items[3]).toHaveTextContent("EnrichWaiting");
  });

  it("restarts from an earlier stage chosen in the menu", async () => {
    const f = stubFetch({ "/restart": { ok: true, status: 202, json: async () => ({}) } });
    render(<PipelineTunnel articleId="a1" initial={failed()} />);
    const go = screen.getByRole("button", { name: "Restart" });
    expect(go).toBeDisabled();
    const select = screen.getByRole("combobox");
    // The failed stage itself is not offered again.
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a stage", "Convert"]);
    await userEvent.selectOptions(select, "convert");
    await userEvent.click(go);
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ fromStage: "convert" });
    await waitFor(() => expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("ConvertQueued"));
  });

  it("hides the earlier-stage menu when only one restart point exists", () => {
    const s = failed();
    s.restartFrom = ["analyze"];
    render(<PipelineTunnel articleId="a1" initial={s} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the error and keeps the failure when restart is refused", async () => {
    stubFetch({ "/restart": { ok: false, status: 409, json: async () => ({ error: "Already running" }) } });
    render(<PipelineTunnel articleId="a1" initial={failed()} />);
    await userEvent.click(screen.getByRole("button", { name: "Restart from Analyze" }));
    expect(await screen.findByText("Already running")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart from Analyze" })).toBeEnabled();
  });

  it("disables restart while it is being sent", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<PipelineTunnel articleId="a1" initial={failed()} />);
    await userEvent.click(screen.getByRole("button", { name: "Restart from Analyze" }));
    expect(screen.getByRole("button", { name: "Restarting…" })).toBeDisabled();
  });

  it("explains when a failure has no recorded message", () => {
    const s = failed();
    s.item!.message = null;
    render(<PipelineTunnel articleId="a1" initial={s} />);
    expect(screen.getByLabelText("Error message")).toHaveTextContent("No error message was recorded.");
  });

  it("refetches when this article changes or on reconnect, not for other articles", async () => {
    const next = status(["done", "done", "done", "done", "done", "done"]);
    const f = stubFetch({ "/pipeline": { ok: true, json: async () => next } });
    render(<PipelineTunnel articleId="a1" initial={status(["done", "done", "active", "pending", "pending", "pending"])} />);
    act(() => live!({ t: "Article", article: "other" }));
    expect(f).not.toHaveBeenCalled();
    act(() => live!({ t: "Article", article: "a1" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Pipeline finished. Ready."));
    expect(f).toHaveBeenCalledWith("/api/articles/a1/pipeline", expect.objectContaining({ cache: "no-store" }));
    act(() => live!(null));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it("keeps the last state when a refetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<PipelineTunnel articleId="a1" initial={status(["done", "done", "active", "pending", "pending", "pending"])} />);
    act(() => live!(null));
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("Currently analyzing.");
  });

  describe("stage details", () => {
    const detail = {
      stage: "analyze", about: "Findings were written.", error: "Bad JSON",
      facts: [{ label: "Model", value: "llama" }], lists: [{ label: "Products", items: ["VPN", "SSO"] }],
      runs: [{ status: "failed", duration: "3 s", startedAt: "10:00" }],
    };

    it("opens a panel with loading text, then the details", async () => {
      stubFetch({ "/pipeline/analyze": { ok: true, json: async () => detail } });
      render(<PipelineTunnel articleId="a1" initial={failed()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Analyze/ }));
      expect(await screen.findByText("Findings were written.")).toBeInTheDocument();
      expect(screen.getByText("llama")).toBeInTheDocument();
      expect(screen.getByText("VPN")).toBeInTheDocument();
      expect(screen.getByText("10:00 · failed · 3 s")).toBeInTheDocument();
      expect(screen.getByText("Bad JSON")).toBeInTheDocument();
    });

    it("shows Loading until the details arrive", async () => {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
      render(<PipelineTunnel articleId="a1" initial={failed()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Analyze/ }));
      expect(screen.getByText("Loading…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Analyze/ })).toHaveAttribute("aria-expanded", "true");
    });

    it("closes the panel when the same stage is clicked again", async () => {
      stubFetch({ "/pipeline/analyze": { ok: true, json: async () => detail } });
      render(<PipelineTunnel articleId="a1" initial={failed()} />);
      const btn = screen.getByRole("button", { name: /^Analyze/ });
      await userEvent.click(btn);
      await screen.findByText("Findings were written.");
      await userEvent.click(btn);
      expect(screen.queryByText("Findings were written.")).not.toBeInTheDocument();
      expect(btn).toHaveAttribute("aria-expanded", "false");
    });
  });
});
