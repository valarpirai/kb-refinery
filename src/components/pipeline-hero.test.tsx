// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PathStage, RefiningPath } from "@/lib/pipeline/path";
import { PipelineHero } from "./pipeline-hero";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a> }));
vi.mock("./pipeline-hero.css", () => ({}));
vi.mock("./live-number.css", () => ({}));

let live: ((e: { t: string } | null) => void) | null = null;
vi.mock("@/lib/use-live", () => ({ useLive: (h: typeof live) => { live = h; } }));

const pane = { label: "In", caption: "before", kind: "code" as const, text: "raw text" };
const stage = (id: PathStage["id"], ringIndex: number | null, count: number, over: Partial<PathStage> = {}): PathStage => ({
  id, kind: id === "ready" ? "core" : "ring", ringIndex, name: `Name ${id}`, sub: `Sub ${id}`, desc: `Desc ${id}`, count, progress: 0.25, example: null, emptyMessage: "Nothing to show for this article.", ...over,
});

/**
 * Build the path data for counts mode, with overrides.
 * @param over fields to override
 */
const data = (over: Partial<RefiningPath> = {}): RefiningPath => ({
  job: null,
  stages: [
    stage("ingested", 1, 3),
    stage("converted", 2, 1, { example: { in: pane, out: { label: "Out", caption: "after", kind: "list", items: [{ label: "Title", text: "Hello" }] } } }),
    stage("analyzed", 3, 0),
    stage("enriching", 4, 2),
    stage("ready", null, 9),
  ],
  exits: [{ id: "no_gaps", name: "No gaps found", count: 4, share: 0.2 }, { id: "failed", name: "Failed", count: 1, share: 0.05 }],
  stats: { onPath: 15, ready: 9, working: 6, leftEarly: 5 },
  sourceCount: 1200, notRefined: 30,
  scoreTrack: { raw: 41, converted: 55, enriched: null },
  articles: [{ id: "a1", title: "VPN guide", stage: "ready", label: "AI-ready" }],
  selectedArticleId: "", here: null, steps: null, article: null, sizes: null, live: false,
  ...over,
});

/** Data for one article that is analyzing. */
const articleData = (): RefiningPath => data({
  selectedArticleId: "a1",
  here: { stage: "analyzed", label: "Analyzing" },
  steps: { ingested: "done", converted: "done", analyzed: "active", enriching: "waiting", ready: "waiting" },
  article: { id: "a1", title: "VPN guide", analysisId: "an1" },
  sizes: { original: 2048, converted: 900, rewritten: null },
});

describe("PipelineHero in counts mode", () => {
  it("lists every state with its count, and the source numbers", () => {
    render(<PipelineHero data={data()} />);
    const rows = within(screen.getByRole("list", { name: "Refining states" })).getAllByRole("button");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Name ingested");
    expect(rows[0]).toHaveTextContent("3");
    expect(rows[4]).toHaveTextContent("9");
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("AI-ready KB")).toBeInTheDocument();
  });

  it("shows the on-path pill and the score track with a dash for unknown", () => {
    render(<PipelineHero data={data()} />);
    expect(screen.getByText("On the path")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("41")).toBeInTheDocument();
    expect(screen.getByText("–")).toBeInTheDocument();
    expect(screen.getByText(/Average mechanical score/)).toBeInTheDocument();
  });

  it("lists the exits with counts", () => {
    render(<PipelineHero data={data()} />);
    const exits = screen.getByRole("list", { name: "Left the path" });
    expect(exits).toHaveTextContent("No gaps found4");
    expect(exits).toHaveTextContent("Failed1");
  });

  it("opens one state with its description and example, and goes back", async () => {
    render(<PipelineHero data={data()} />);
    await userEvent.click(screen.getByRole("button", { name: /Name converted/ }));
    expect(screen.getByRole("heading", { name: "Name converted" })).toBeInTheDocument();
    expect(screen.getByText("Desc converted")).toBeInTheDocument();
    expect(document.querySelector(".ph-count-line")).toHaveTextContent("1 article in this state");
    expect(screen.getByText("raw text")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "‹ All states" }));
    expect(screen.getByRole("list", { name: "Refining states" })).toBeInTheDocument();
  });

  it("uses the plural for other counts and prompts for an article when there is no example", async () => {
    render(<PipelineHero data={data()} />);
    await userEvent.click(screen.getByRole("button", { name: /Name ingested/ }));
    expect(document.querySelector(".ph-count-line")).toHaveTextContent("3 articles in this state");
    expect(screen.getByText("Pick an article above to see its real input and output here.")).toBeInTheDocument();
  });

  it("steps to the next state, and the last state has no next", async () => {
    render(<PipelineHero data={data()} />);
    await userEvent.click(screen.getByRole("button", { name: /Name enriching/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next · Name ready ›" }));
    expect(screen.getByRole("heading", { name: "Name ready" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next/ })).not.toBeInTheDocument();
  });

  it("hides the picker when there are no articles", () => {
    render(<PipelineHero data={data({ articles: [] })} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("navigates to the chosen article, or home for all", async () => {
    render(<PipelineHero data={data({ articles: [{ id: "a b", title: "VPN guide", stage: "ready", label: "AI-ready" }] })} />);
    const select = screen.getByRole("combobox");
    expect(screen.getByRole("option", { name: "VPN guide · AI-ready" })).toBeInTheDocument();
    await userEvent.selectOptions(select, "a b");
    expect(replace).toHaveBeenCalledWith("/?article=a%20b", { scroll: false });
    await userEvent.selectOptions(select, "");
    expect(replace).toHaveBeenLastCalledWith("/", { scroll: false });
  });
});

describe("PipelineHero with an article chosen", () => {
  it("shows where the article is, as a step and a word", () => {
    render(<PipelineHero data={articleData()} />);
    expect(screen.getByText("This article · step 3 of 5")).toBeInTheDocument();
    expect(screen.getByText("Analyzing", { selector: ".ph-here-value" })).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Refining states" })).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Done");
    expect(rows[2]).toHaveTextContent("In progress");
    expect(rows[2]).toHaveTextContent("this article");
    expect(rows[3]).toHaveTextContent("Waiting");
    expect(screen.getByText("Not yet")).toBeInTheDocument();
  });

  it("shows only the exit the article took, and none when it stays on the path", () => {
    const { unmount } = render(<PipelineHero data={articleData()} />);
    expect(within(screen.getByRole("list", { name: "Left the path" })).queryAllByRole("listitem")).toHaveLength(0);
    unmount();
    render(<PipelineHero data={{ ...articleData(), here: { stage: "failed", label: "Failed" } }} />);
    const items = within(screen.getByRole("list", { name: "Left the path" })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Failed");
    expect(items[0]).toHaveTextContent("this article");
  });

  it("links to the analysis and shows file sizes with a dash for a missing version", () => {
    render(<PipelineHero data={articleData()} />);
    expect(screen.getByRole("link", { name: "View analysis" })).toHaveAttribute("href", "/analysis/an1");
    const dl = screen.getByLabelText("File size at each version");
    expect(dl).toHaveTextContent("Original2.0 KB");
    expect(dl).toHaveTextContent("Markdown900 B");
    expect(dl).toHaveTextContent("Rewritten–");
  });

  it("shows the article on the source card instead of counts", () => {
    render(<PipelineHero data={articleData()} />);
    expect(screen.queryByText("1,200")).not.toBeInTheDocument();
    expect(screen.getAllByText("VPN guide").length).toBeGreaterThan(0);
  });

  it("says AI-ready and published when the article is done", () => {
    render(<PipelineHero data={{ ...articleData(), here: { stage: "ready", label: "AI-ready" }, steps: { ingested: "done", converted: "done", analyzed: "done", enriching: "done", ready: "done" } }} />);
    expect(screen.getByText("AI-ready", { selector: ".ph-core-word" })).toBeInTheDocument();
    expect(screen.getByText("published")).toBeInTheDocument();
  });

  it("says No gaps when the last step was not needed, and Failed when it failed", () => {
    const base = articleData();
    const { rerender } = render(<PipelineHero data={{ ...base, steps: { ...base.steps!, ready: "skipped" } }} />);
    expect(screen.getByText("No gaps", { selector: ".ph-core-word" })).toBeInTheDocument();
    rerender(<PipelineHero data={{ ...base, steps: { ...base.steps!, ready: "failed" } }} />);
    expect(screen.getByText("Failed", { selector: ".ph-core-word" })).toBeInTheDocument();
  });

  it("detail view shows this article's step, or the empty message when it has no example", async () => {
    render(<PipelineHero data={articleData()} />);
    await userEvent.click(screen.getByRole("button", { name: /Name analyzed/ }));
    expect(screen.getByText("This article:")).toBeInTheDocument();
    expect(screen.getByText("Nothing to show for this article.")).toBeInTheDocument();
    expect(screen.getByText("this article is here")).toBeInTheDocument();
  });
});

describe("PipelineHero live refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    live = null;
  });
  afterEach(() => vi.useRealTimers());

  it("turns a burst of pipeline changes into one refresh after 600 ms", () => {
    render(<PipelineHero data={data()} />);
    act(() => { live!({ t: "Job" }); live!({ t: "StageRun" }); live!({ t: "Article" }); });
    expect(refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(650); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores tables the path does not use", () => {
    render(<PipelineHero data={data()} />);
    act(() => { live!({ t: "Notification" }); vi.advanceTimersByTime(1000); });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes after a reconnect", () => {
    render(<PipelineHero data={data()} />);
    act(() => { live!(null); vi.advanceTimersByTime(650); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while the tab is hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<PipelineHero data={data()} />);
    act(() => { live!({ t: "Job" }); vi.advanceTimersByTime(650); });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels a pending refresh on unmount", () => {
    const { unmount } = render(<PipelineHero data={data()} />);
    act(() => { live!({ t: "Job" }); });
    unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(refresh).not.toHaveBeenCalled();
  });
});
