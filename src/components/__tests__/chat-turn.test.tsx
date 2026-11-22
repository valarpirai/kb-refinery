// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Arm, ComparisonData } from "@/app/(app)/chat/types";
import { refinedFirst } from "@/lib/chat/blind";
import { ChatTurn, isBusy } from ".././chat-turn";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("remark-gfm", () => ({ default: () => {} }));

/**
 * Build an arm.
 * @param variant which docs it answers from
 * @param over fields to override
 */
const arm = (variant: "original" | "refined", over: Partial<Arm> = {}): Arm => ({
  id: `arm-${variant}`, variant, status: "completed", answer: `${variant} answer`, sources: [], latencyMs: 1500, error: null, judge: null, ...over,
});

/**
 * Build a comparison.
 * @param over fields to override
 */
const cmp = (over: Partial<ComparisonData> = {}): ComparisonData => ({
  id: "cmp-a", conversationId: "c", query: "How do I?", verdict: null, note: null, createdAt: "2026-01-01", arms: [arm("original"), arm("refined")], ...over,
});

describe("isBusy", () => {
  it("is true when any arm is pending or running", () => {
    expect(isBusy(cmp({ arms: [arm("original"), arm("refined", { status: "running" })] }))).toBe(true);
    expect(isBusy(cmp({ arms: [arm("original", { status: "pending" }), arm("refined")] }))).toBe(true);
    expect(isBusy(cmp())).toBe(false);
    expect(isBusy(cmp({ arms: [arm("original", { status: "failed" }), arm("refined")] }))).toBe(false);
  });
});

describe("ChatTurn", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the question, both answers with latency, and a ready status", () => {
    render(<ChatTurn cmp={cmp()} blind={false} fresh={false} onChange={() => {}} />);
    expect(screen.getByText("How do I?")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Original docs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refined docs" })).toBeInTheDocument();
    expect(screen.getAllByText("1.5s")).toHaveLength(2);
    expect(screen.getByText("Both answers are ready.")).toBeInTheDocument();
  });

  it("puts the answers in the order the comparison id decides", () => {
    const c = cmp({ id: "cmp-a" });
    render(<ChatTurn cmp={c} blind={false} fresh={false} onChange={() => {}} />);
    const first = screen.getAllByRole("heading", { level: 3 })[0].textContent;
    expect(first).toBe(refinedFirst(c.id) ? "Refined docs" : "Original docs");
  });

  it("hides which side is which in blind mode until a verdict exists", () => {
    const { rerender } = render(<ChatTurn cmp={cmp()} blind fresh={false} onChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Answer A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A is better" })).toBeInTheDocument();
    expect(screen.getByText(/Blind mode/)).toBeInTheDocument();
    rerender(<ChatTurn cmp={cmp({ verdict: "tie" })} blind fresh={false} onChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Original docs" })).toBeInTheDocument();
  });

  it("shows typing indicator for a waiting arm and no verdict buttons", () => {
    render(<ChatTurn cmp={cmp({ arms: [arm("original", { status: "running", answer: null }), arm("refined")] })} blind={false} fresh={false} onChange={() => {}} />);
    expect(screen.getByText("Writing the answer…")).toBeInTheDocument();
    expect(screen.getByText("Answering…")).toBeInTheDocument();
    expect(screen.queryByText("Which answer is better?")).not.toBeInTheDocument();
  });

  it("shows a failed arm's error and the failure status", () => {
    render(<ChatTurn cmp={cmp({ arms: [arm("original", { status: "failed", answer: null, error: "Model down" }), arm("refined")] })} blind={false} fresh={false} onChange={() => {}} />);
    expect(screen.getByText("Model down")).toBeInTheDocument();
    expect(screen.getByText("One or more answers failed.")).toBeInTheDocument();
  });

  it("lists sources with links to the analysis when there is one", () => {
    const sources = [
      { n: 1, articleId: "a", analysisId: "an1", title: "Linked", heading: "Intro", score: 0.9123, excerpt: "text one" },
      { n: 2, articleId: "b", analysisId: null, title: "Plain", heading: null, score: 0.5, excerpt: "text two" },
    ];
    render(<ChatTurn cmp={cmp({ arms: [arm("original", { sources }), arm("refined")] })} blind={false} fresh={false} onChange={() => {}} />);
    expect(screen.getByText("Sources used (2)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Linked" })).toHaveAttribute("href", "/analysis/an1");
    expect(screen.queryByRole("link", { name: "Plain" })).not.toBeInTheDocument();
    expect(screen.getByText(/match 0.91/)).toBeInTheDocument();
    expect(screen.getByText("text two")).toBeInTheDocument();
  });

  it("sets a verdict with PATCH and reports the result", async () => {
    const next = cmp({ verdict: "tie" });
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => next });
    vi.stubGlobal("fetch", f);
    const onChange = vi.fn();
    render(<ChatTurn cmp={cmp()} blind={false} fresh={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "About the same" }));
    expect(f).toHaveBeenCalledWith("/api/compare/cmp-a", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ verdict: "tie" }) }));
    expect(onChange).toHaveBeenCalledWith(next);
  });

  it("clicking the chosen verdict again clears it", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => cmp() });
    vi.stubGlobal("fetch", f);
    render(<ChatTurn cmp={cmp({ verdict: "tie" })} blind={false} fresh={false} onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: "About the same" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ verdict: null });
  });

  it("auto-judges, shows the judging state, and polls until judged", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const judged = cmp({ arms: [arm("original", { judge: { score: 4, reasoning: "Clear" } }), arm("refined", { judge: { score: 5, reasoning: "Better" } })] });
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => judged };
    });
    vi.stubGlobal("fetch", f);
    const onChange = vi.fn();
    render(<ChatTurn cmp={cmp()} blind={false} fresh={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Auto-judge with the local model" }));
    expect(f).toHaveBeenCalledWith("/api/compare/cmp-a/judge", { method: "POST" });
    expect(screen.getByRole("button", { name: /Judging/ })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(onChange).toHaveBeenCalledWith(judged);
    // Polling saw both judges, so the judging state ends.
    expect(screen.queryByRole("button", { name: /Judging/ })).not.toBeInTheDocument();
  });

  it("shows Auto-judged and the judge text when already judged", () => {
    const c = cmp({ arms: [arm("original", { judge: { score: 4, reasoning: "Clear" } }), arm("refined", { judge: { score: 5, reasoning: "Better" } })] });
    render(<ChatTurn cmp={c} blind={false} fresh={false} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Auto-judged" })).toBeDisabled();
    expect(screen.getByText("Auto-judge: 4/5.")).toBeInTheDocument();
    expect(screen.getByText(/Better/)).toBeInTheDocument();
  });

  it("shows the server error when judging cannot start", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Model offline" }) }));
    render(<ChatTurn cmp={cmp()} blind={false} fresh={false} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Auto-judge with the local model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model offline");
    expect(screen.getByRole("button", { name: "Auto-judge with the local model" })).toBeEnabled();
  });

  it("polls every 2 seconds while an answer is pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done = cmp();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => done });
    vi.stubGlobal("fetch", f);
    const onChange = vi.fn();
    render(<ChatTurn cmp={cmp({ arms: [arm("original", { status: "pending", answer: null }), arm("refined")] })} blind={false} fresh={false} onChange={onChange} />);
    expect(f).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(f).toHaveBeenCalledWith("/api/compare/cmp-a", { cache: "no-store" });
    expect(onChange).toHaveBeenCalledWith(done);
  });

  it("does not poll when nothing is pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<ChatTurn cmp={cmp()} blind={false} fresh={false} onChange={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(f).not.toHaveBeenCalled();
  });
});
