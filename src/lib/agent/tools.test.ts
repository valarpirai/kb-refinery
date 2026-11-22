import { describe, expect, it, vi } from "vitest";

vi.mock("@strands-agents/sdk", () => ({
  tool: (cfg: unknown) => cfg,
}));
vi.mock("@/lib/db", () => ({
  db: {
    article: { findMany: vi.fn(), count: vi.fn() },
    job: { findUnique: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    jobItem: { groupBy: vi.fn() },
    analysis: { groupBy: vi.fn() },
    finding: { groupBy: vi.fn() },
    snapshot: { groupBy: vi.fn() },
    product: { findMany: vi.fn() },
    chunk: { groupBy: vi.fn() },
    comparison: { groupBy: vi.fn() },
  },
}));
vi.mock("@/lib/ingest/import", () => ({ runImport: vi.fn() }));
vi.mock("@/lib/pipeline/jobs", () => ({ createJob: vi.fn() }));
vi.mock("@/lib/pipeline/restart", () => ({ listFailedItems: vi.fn(), restartJobItem: vi.fn() }));
vi.mock("@/lib/chat/retrieve", () => ({ MIN_SCORE: 0.6, retrieve: vi.fn() }));
vi.mock("@/lib/chat/embed", () => ({ embed: vi.fn(async () => [[0.1]]) }));
vi.mock("./crawl", () => ({ crawl: vi.fn() }));

import type { z } from "zod";
import { db } from "@/lib/db";
import { runImport } from "@/lib/ingest/import";
import { createJob } from "@/lib/pipeline/jobs";
import { listFailedItems, restartJobItem } from "@/lib/pipeline/restart";
import { retrieve } from "@/lib/chat/retrieve";
import { embed } from "@/lib/chat/embed";
import { crawl } from "./crawl";
import { TOOL_NAMES } from "./catalog";
import { buildTools } from "./tools";

interface FakeTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  callback: (input: never) => Promise<string>;
}

/** Call a tool by name and parse its JSON answer. */
async function call(name: string, input: object = {}, ctx = { userId: "u1" }) {
  const t = (buildTools(ctx) as unknown as FakeTool[]).find((x) => x.name === name)!;
  const parsed = t.inputSchema.parse(input);
  return JSON.parse(await t.callback(parsed as never));
}

describe("buildTools", () => {
  it("builds every tool in the catalog", () => {
    expect((buildTools({ userId: "u" }) as unknown as FakeTool[]).map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it("filters to the enabled names", () => {
    const names = (buildTools({ userId: "u" }, ["get_stats", "nope"]) as unknown as FakeTool[]).map((t) => t.name);
    expect(names).toEqual(["get_stats"]);
  });

  it("returns no tools for an empty enabled list", () => {
    expect(buildTools({ userId: "u" }, [])).toEqual([]);
  });
});

describe("import_from_url", () => {
  it("applies input defaults", () => {
    const t = (buildTools({ userId: "u" }) as unknown as FakeTool[]).find((x) => x.name === "import_from_url")!;
    expect(t.inputSchema.parse({ url: "https://a.com" })).toEqual({ url: "https://a.com", only_this_page: false, max_pages: 10 });
    expect(() => t.inputSchema.parse({ url: "x", max_pages: 51 })).toThrow();
    expect(() => t.inputSchema.parse({ url: "x", max_pages: 0 })).toThrow();
  });

  it("crawls linked pages and imports them", async () => {
    vi.mocked(crawl).mockResolvedValue({ pages: [{ url: "https://a.com/help/Intro_Page", html: "<p>x</p>" }], errors: ["one problem"] });
    vi.mocked(runImport).mockResolvedValue({ id: "run1", created: 1, updated: 0, skipped: 2, errors: ["imp err"] } as never);
    const out = await call("import_from_url", { url: "https://a.com/help" });
    expect(crawl).toHaveBeenCalledWith("https://a.com/help", 10, true);
    expect(vi.mocked(runImport).mock.calls[0][0]).toMatchObject({
      kind: "articles", label: "Website: a.com", userId: "u1",
      files: [{ name: "a-com-help-Intro-Page.html", text: "<p>x</p>", url: "https://a.com/help/Intro_Page" }],
    });
    expect(out).toEqual({ ok: true, import_run_id: "run1", pages_fetched: 1, created: 1, updated: 0, unchanged: 2, problems: ["one problem", "imp err"] });
  });

  it("fetches one page when only_this_page is set", async () => {
    vi.mocked(crawl).mockResolvedValue({ pages: [{ url: "https://a.com/", html: "" }], errors: [] });
    vi.mocked(runImport).mockResolvedValue({ id: "r", created: 1, updated: 0, skipped: 0, errors: [] } as never);
    await call("import_from_url", { url: "https://a.com/", only_this_page: true });
    expect(crawl).toHaveBeenCalledWith("https://a.com/", 1, false);
  });

  it("asks for at least two pages when following links", async () => {
    vi.mocked(crawl).mockResolvedValue({ pages: [{ url: "https://a.com/", html: "" }], errors: [] });
    vi.mocked(runImport).mockResolvedValue({ id: "r", created: 1, updated: 0, skipped: 0, errors: [] } as never);
    await call("import_from_url", { url: "https://a.com/", max_pages: 1 });
    expect(crawl).toHaveBeenCalledWith("https://a.com/", 2, true);
  });

  it("uses the page name when the URL has no path text", async () => {
    vi.mocked(crawl).mockResolvedValue({ pages: [{ url: "https://a.com/", html: "" }], errors: [] });
    vi.mocked(runImport).mockResolvedValue({ id: "r", created: 1, updated: 0, skipped: 0, errors: [] } as never);
    await call("import_from_url", { url: "https://a.com/" });
    expect(vi.mocked(runImport).mock.calls[0][0].files[0].name).toBe("a-com.html");
  });

  it("returns an error when the crawl throws", async () => {
    vi.mocked(crawl).mockRejectedValue(new Error("Only http and https URLs can be fetched"));
    expect(await call("import_from_url", { url: "ftp://x" })).toEqual({ ok: false, error: "Only http and https URLs can be fetched" });
    expect(runImport).not.toHaveBeenCalled();
  });

  it("returns the first problem when no page was fetched", async () => {
    vi.mocked(crawl).mockResolvedValue({ pages: [], errors: ["a 500", "b 500", "c 500", "d 500"] });
    const out = await call("import_from_url", { url: "https://a.com/" });
    expect(out).toEqual({ ok: false, error: "a 500", problems: ["a 500", "b 500", "c 500"] });
  });

  it("gives a default error when nothing was fetched and nothing failed", async () => {
    vi.mocked(crawl).mockResolvedValue({ pages: [], errors: [] });
    expect((await call("import_from_url", { url: "https://a.com/" })).error).toBe("No pages could be fetched");
  });
});

describe("start_refine", () => {
  it("refines the articles of an import run", async () => {
    vi.mocked(db.article.findMany).mockResolvedValue([{ id: "a1" }, { id: "a2" }] as never);
    vi.mocked(createJob).mockResolvedValue({ id: "j1" } as never);
    const out = await call("start_refine", { import_run_id: "run1" });
    expect(db.article.findMany).toHaveBeenCalledWith({ where: { importRunId: "run1" }, select: { id: true }, take: 100 });
    expect(createJob).toHaveBeenCalledWith(["a1", "a2"], "2 article(s) started by the agent", "u1");
    expect(out).toMatchObject({ ok: true, job_id: "j1", articles: 2 });
  });

  it("prefers explicit article ids", async () => {
    vi.mocked(createJob).mockResolvedValue({ id: "j2" } as never);
    await call("start_refine", { article_ids: ["x"], import_run_id: "run1" });
    expect(db.article.findMany).not.toHaveBeenCalled();
    expect(vi.mocked(createJob).mock.calls[0][0]).toEqual(["x"]);
  });

  it("refuses when there is nothing to refine", async () => {
    vi.mocked(db.article.findMany).mockResolvedValue([]);
    expect((await call("start_refine", { import_run_id: "run1" })).ok).toBe(false);
    expect((await call("start_refine", {})).ok).toBe(false);
    expect((await call("start_refine", { article_ids: [] })).ok).toBe(false);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe("restart_failed", () => {
  const item = (id: string, title: string) => ({ id, jobId: `job-${id}`, article: { title } });

  it("reports when nothing failed", async () => {
    vi.mocked(listFailedItems).mockResolvedValue([]);
    expect(await call("restart_failed")).toEqual({ ok: true, queued: 0, note: "No failed articles to restart." });
    expect(listFailedItems).toHaveBeenCalledWith(25);
  });

  it("queues failed items and lists those it skipped", async () => {
    vi.mocked(listFailedItems).mockResolvedValue([item("1", "One"), item("2", "Two")] as never);
    vi.mocked(restartJobItem).mockResolvedValueOnce({ ok: true, fromStage: "rewrite" }).mockResolvedValueOnce({ ok: false, status: 409, error: "Already running" });
    const out = await call("restart_failed", { limit: 5 });
    expect(listFailedItems).toHaveBeenCalledWith(5);
    expect(out).toMatchObject({
      ok: true, queued: 1,
      articles: [{ title: "One", from_stage: "rewrite", job_id: "job-1" }],
      skipped: ["Two: Already running"],
    });
  });

  it("reports skipped items even when none were queued", async () => {
    vi.mocked(listFailedItems).mockResolvedValue([item("1", "One")] as never);
    vi.mocked(restartJobItem).mockResolvedValue({ ok: false, status: 404, error: "gone" });
    const out = await call("restart_failed");
    expect(out.queued).toBe(0);
    expect(out.skipped).toEqual(["One: gone"]);
  });
});

describe("get_job_status", () => {
  const job = { id: "j1", status: "running", scope: "3 articles", articlesTotal: 3, findingsGenerated: 4, duplicatesFound: 1 };

  it("looks up a job by id", async () => {
    vi.mocked(db.job.findUnique).mockResolvedValue(job as never);
    vi.mocked(db.jobItem.groupBy).mockResolvedValue([{ status: "ready", _count: 2 }, { status: "failed", _count: 1 }] as never);
    const out = await call("get_job_status", { job_id: "j1" });
    expect(db.job.findUnique).toHaveBeenCalledWith({ where: { id: "j1" } });
    expect(out).toEqual({ ok: true, job_id: "j1", status: "running", scope: "3 articles", articles: 3, by_stage: { ready: 2, failed: 1 }, findings: 4, duplicates: 1 });
  });

  it("falls back to the user's latest job", async () => {
    vi.mocked(db.job.findFirst).mockResolvedValue(job as never);
    vi.mocked(db.jobItem.groupBy).mockResolvedValue([] as never);
    await call("get_job_status", {});
    expect(db.job.findFirst).toHaveBeenCalledWith({ where: { userId: "u1" }, orderBy: { createdAt: "desc" } });
  });

  it("returns an error when there is no job", async () => {
    vi.mocked(db.job.findFirst).mockResolvedValue(null);
    expect(await call("get_job_status", {})).toEqual({ ok: false, error: "No job found" });
    expect(db.jobItem.groupBy).not.toHaveBeenCalled();
  });
});

describe("get_stats", () => {
  function mockAll() {
    vi.mocked(db.article.count).mockResolvedValue(7 as never);
    vi.mocked(db.analysis.groupBy).mockResolvedValue([{ pipelineStage: "ready", _count: 5 }] as never);
    vi.mocked(db.finding.groupBy).mockResolvedValue([{ severity: "high", _count: 2 }, { severity: null, _count: 1 }] as never);
    vi.mocked(db.snapshot.groupBy).mockResolvedValue([{ type: "raw", _avg: { score: 40.4, llmScore: null } }, { type: "enriched", _avg: { score: 80.6, llmScore: 70.5 } }] as never);
    vi.mocked(db.product.findMany).mockResolvedValue([{ name: "P", articleCount: 3 }] as never);
    vi.mocked(db.job.groupBy).mockResolvedValue([{ status: "completed", _count: 4 }] as never);
    vi.mocked(db.chunk.groupBy).mockResolvedValue([{ variant: "refined", _count: 9 }] as never);
    vi.mocked(db.comparison.groupBy).mockResolvedValue([{ verdict: "refined", _count: 2 }] as never);
    vi.mocked(listFailedItems).mockResolvedValue([
      { articleId: "a1", article: { title: "Bad" }, failedStage: "rewrite", message: "m".repeat(300) },
      { articleId: "a2", article: { title: "Worse" }, failedStage: null, message: null },
    ] as never);
  }

  it("summarizes the knowledge base", async () => {
    mockAll();
    const out = await call("get_stats");
    expect(out.articles).toBe(7);
    expect(out.analysis_pipeline_stage).toEqual({ ready: 5 });
    expect(out.open_findings_by_severity).toEqual({ high: 2, unrated: 1 });
    expect(out.average_scores).toEqual({ raw: { mechanical: 40, model: null }, enriched: { mechanical: 81, model: 71 } });
    expect(out.top_products).toEqual([{ name: "P", articleCount: 3 }]);
    expect(out.jobs_by_status).toEqual({ completed: 4 });
    expect(out.chat_index_chunks).toEqual({ refined: 9 });
    expect(out.your_comparison_verdicts).toEqual({ refined: 2 });
  });

  it("describes failed articles, cutting long errors", async () => {
    mockAll();
    const out = await call("get_stats");
    expect(out.failed_articles[0]).toEqual({ article_id: "a1", title: "Bad", failed_at_stage: "rewrite", error: "m".repeat(200) });
    expect(out.failed_articles[1]).toEqual({ article_id: "a2", title: "Worse", failed_at_stage: "unknown", error: "" });
  });

  it("scopes verdicts to the user", async () => {
    mockAll();
    await call("get_stats", {}, { userId: "zed" });
    expect(vi.mocked(db.comparison.groupBy).mock.calls[0][0]).toMatchObject({ where: { conversation: { userId: "zed" } } });
  });
});

describe("search_articles", () => {
  it("rejects an empty query", () => {
    const t = (buildTools({ userId: "u" }) as unknown as FakeTool[]).find((x) => x.name === "search_articles")!;
    expect(() => t.inputSchema.parse({ query: "" })).toThrow();
  });

  it("maps rows and links reports", async () => {
    vi.mocked(db.article.findMany).mockResolvedValue([
      { id: "a1", title: "VPN", knowledgeBase: "KB", url: "u", analysis: { id: "an1", pipelineStage: "ready", _count: { findings: 3 } } },
      { id: "a2", title: "Other", knowledgeBase: null, url: null, analysis: null },
    ] as never);
    const out = await call("search_articles", { query: "vpn" });
    expect(vi.mocked(db.article.findMany).mock.calls[0][0]).toMatchObject({ where: { title: { contains: "vpn", mode: "insensitive" } }, take: 10 });
    expect(out).toEqual([
      { article_id: "a1", title: "VPN", knowledge_base: "KB", url: "u", stage: "ready", open_findings: 3, report: "/analysis/an1" },
      { article_id: "a2", title: "Other", knowledge_base: null, url: null, stage: "not refined", open_findings: 0, report: null },
    ]);
  });
});

describe("search_knowledge", () => {
  const src = (n: number, score: number) => ({ n, articleId: `a${n}`, analysisId: null, title: `T${n}`, heading: "H", score, excerpt: `E${n}` });

  it("rejects a question shorter than three characters", () => {
    const t = (buildTools({ userId: "u" }) as unknown as FakeTool[]).find((x) => x.name === "search_knowledge")!;
    expect(() => t.inputSchema.parse({ question: "hi" })).toThrow();
  });

  it("searches everything when no product is named", async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([{ name: "Zoom", aliases: "" }] as never);
    vi.mocked(retrieve).mockResolvedValue([src(1, 0.8456)]);
    const out = await call("search_knowledge", { question: "how do I reset my password" });
    expect(embed).toHaveBeenCalledWith(["how do I reset my password"], "query");
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith("refined", [0.1], "how do I reset my password", 0.6);
    expect(out).toEqual({
      products_in_question: [], searched_only_articles_about_them: false,
      excerpts: [{ n: 1, article_id: "a1", title: "T1", heading: "H", relevance: 0.85, excerpt: "E1" }],
    });
  });

  it("narrows to tagged articles when a product is named by name or alias", async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([{ name: "Microsoft Teams", aliases: "ms teams, teams" }, { name: "Zoom", aliases: "" }] as never);
    vi.mocked(retrieve).mockResolvedValue([src(1, 0.9)]);
    const out = await call("search_knowledge", { question: "How to mute in MS Teams?" });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith("refined", [0.1], "How to mute in MS Teams?", 0.6, ["microsoft teams"]);
    expect(out.products_in_question).toEqual(["Microsoft Teams"]);
    expect(out.searched_only_articles_about_them).toBe(true);
  });

  it("falls back to an unfiltered search when the narrowed search is empty", async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([{ name: "Zoom", aliases: "" }] as never);
    vi.mocked(retrieve).mockResolvedValueOnce([]).mockResolvedValueOnce([src(1, 0.7)]);
    const out = await call("search_knowledge", { question: "zoom audio broken" });
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(vi.mocked(retrieve).mock.calls[1]).toEqual(["refined", [0.1], "zoom audio broken", 0.6]);
    expect(out.searched_only_articles_about_them).toBe(false);
    expect(out.products_in_question).toEqual(["Zoom"]);
    expect(out.excerpts).toHaveLength(1);
  });

  it("matches whole words only", async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([{ name: "Go", aliases: "" }, { name: "Cat", aliases: "" }] as never);
    vi.mocked(retrieve).mockResolvedValue([]);
    const out = await call("search_knowledge", { question: "category going well" });
    expect(out.products_in_question).toEqual([]);
  });

  it("treats regex characters in product names literally", async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([{ name: "C++", aliases: "" }, { name: "A.B", aliases: "" }] as never);
    vi.mocked(retrieve).mockResolvedValue([]);
    expect((await call("search_knowledge", { question: "compile c++ code" })).products_in_question).toEqual(["C++"]);
    expect((await call("search_knowledge", { question: "what is axb here" })).products_in_question).toEqual([]);
  });

  it("returns an empty excerpt list when nothing is relevant", async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([] as never);
    vi.mocked(retrieve).mockResolvedValue([]);
    expect((await call("search_knowledge", { question: "unknown topic" })).excerpts).toEqual([]);
  });
});
