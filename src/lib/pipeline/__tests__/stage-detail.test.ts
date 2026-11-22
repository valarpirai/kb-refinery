import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    article: { findUnique: vi.fn() },
    snapshot: { findFirst: vi.fn(), findMany: vi.fn() },
    chunk: { groupBy: vi.fn() },
    stageRun: { findMany: vi.fn() },
    jobItem: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: h.db }));

import { getStageDetail, type StageDetail, type StepKey } from ".././stage-detail";

const CREATED = new Date("2026-02-03T04:05:06Z");

interface Setup {
  article?: Record<string, unknown>;
  analysis?: Record<string, unknown> | null;
  snaps?: Record<string, unknown>[];
  runs?: { status: string; durationMs: number; startedAt: Date }[];
  item?: Record<string, unknown> | null;
  chunks?: { variant: string; _count: number }[];
}

/**
 * Prepare the fake database for one article.
 * @param o what the database should return
 */
function setup(o: Setup = {}) {
  h.db.article.findUnique.mockResolvedValue({
    id: "a1", title: "T", body: "<p>hello</p>", format: "html", knowledgeBase: "IT KB", url: null, createdAt: CREATED,
    dataSource: null, importRun: null, analysis: o.analysis === undefined ? null : o.analysis, ...o.article,
  });
  const snaps = o.snaps ?? [];
  h.db.snapshot.findFirst.mockResolvedValue(snaps.length ? { version: 1 } : null);
  h.db.snapshot.findMany.mockResolvedValue(snaps);
  h.db.chunk.groupBy.mockResolvedValue(o.chunks ?? []);
  h.db.stageRun.findMany.mockResolvedValue(o.runs ?? []);
  h.db.jobItem.findFirst.mockResolvedValue(o.item ?? null);
}

const analysis = (extra: Record<string, unknown> = {}) => ({
  id: "an1", targetAudience: "end_user", standardizedSummary: "A summary", searchTerms: ["vpn", "mfa"], findings: [], mentions: [], enrichmentKnowledge: null, ...extra,
});
const snap = (type: string, extra: Record<string, unknown> = {}) => ({ type, content: "abc", wordCount: 1, score: 50, llmScore: 60, imageCount: 0, linkCount: 0, brokenLinkCount: 0, processingMessage: null, ...extra });
const fact = (d: StageDetail, label: string) => d.facts.find((f) => f.label === label)?.value;
const list = (d: StageDetail, label: string) => d.lists.find((l) => l.label === label)?.items;
const get = async (stage: StepKey) => (await getStageDetail("a1", stage))!;

describe("getStageDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an unknown article", async () => {
    h.db.article.findUnique.mockResolvedValue(null);
    expect(await getStageDetail("nope", "import")).toBeNull();
    expect(h.db.snapshot.findFirst).not.toHaveBeenCalled();
  });

  it("describes every stage in a sentence", async () => {
    setup();
    for (const k of ["import", "convert", "analyze", "enrich", "rewrite", "ready"] as const) {
      const d = await get(k);
      expect(d.stage).toBe(k);
      expect(d.about.length).toBeGreaterThan(20);
    }
  });

  describe("import", () => {
    it("lists source, knowledge base, format, size and import time", async () => {
      setup({ article: { dataSource: { name: "Prod KB" } } });
      const d = await get("import");
      expect(d.facts).toEqual([
        { label: "Source", value: "Prod KB" },
        { label: "Knowledge base", value: "IT KB" },
        { label: "Format", value: "HTML" },
        { label: "Size", value: "12 B" },
        { label: "Imported", value: "2026-02-03 04:05 UTC" },
      ]);
    });

    it("falls back from data source to import run label to manual import", async () => {
      setup({ article: { importRun: { label: "CSV upload" } } });
      expect(fact(await get("import"), "Source")).toBe("CSV upload");
      setup();
      expect(fact(await get("import"), "Source")).toBe("Manual import");
    });

    it("shows None for a missing knowledge base and adds the URL when known", async () => {
      setup({ article: { knowledgeBase: null, url: "https://kb.test/1" } });
      const d = await get("import");
      expect(fact(d, "Knowledge base")).toBe("None");
      expect(fact(d, "URL")).toBe("https://kb.test/1");
    });

    it("measures size in bytes for non-ASCII text", async () => {
      setup({ article: { body: "ééé" } });
      expect(fact(await get("import"), "Size")).toBe("6 B");
    });
  });

  describe("convert", () => {
    it("compares raw and converted sizes and scores", async () => {
      setup({
        analysis: analysis(),
        snaps: [snap("raw", { content: "x".repeat(2048), wordCount: 1500, score: 40, llmScore: 30 }), snap("converted", { content: "y".repeat(1024), wordCount: 900, score: 55, llmScore: 30, imageCount: 2, linkCount: 3, brokenLinkCount: 1 })],
      });
      const d = await get("convert");
      expect(fact(d, "From")).toBe("HTML, 1,500 words · 2.0 KB");
      expect(fact(d, "To")).toBe("Markdown, 900 words · 1.0 KB");
      expect(fact(d, "Mechanical score")).toBe("40 → 55 (+15)");
      expect(fact(d, "Model score")).toBe("30 → 30 (no change)");
      expect(fact(d, "Images / links")).toBe("2 images · 3 links · 1 broken");
    });

    it("shows a decrease with a minus sign", async () => {
      setup({ analysis: analysis(), snaps: [snap("raw", { score: 60 }), snap("converted", { score: 50 })] });
      expect(fact(await get("convert"), "Mechanical score")).toBe("60 → 50 (-10)");
    });

    it("uses dashes when nothing has been converted yet", async () => {
      setup();
      const d = await get("convert");
      expect(fact(d, "From")).toBe("HTML, 12 B");
      expect(fact(d, "To")).toBe("Markdown, –");
      expect(fact(d, "Mechanical score")).toBe("–");
      expect(fact(d, "Images / links")).toBe("0 images · 0 links");
    });

    it("shows a dash when a score is missing on one side", async () => {
      setup({ analysis: analysis(), snaps: [snap("raw", { score: null }), snap("converted")] });
      expect(fact(await get("convert"), "Mechanical score")).toBe("–");
    });
  });

  describe("analyze", () => {
    it("summarises findings by type and severity, audience, terms and products", async () => {
      setup({
        analysis: analysis({
          findings: [
            { type: "outdated", severity: "high", state: "new" },
            { type: "outdated", severity: null, state: "new" },
            { type: "too_vague", severity: "medium", state: "new" },
          ],
          mentions: [{ mentionCount: 2, product: { name: "Okta" } }],
        }),
        snaps: [snap("converted", { llmScore: 77 })],
      });
      const d = await get("analyze");
      expect(fact(d, "Findings")).toBe("3");
      expect(fact(d, "Audience")).toBe("End user");
      expect(fact(d, "Model score of the Markdown")).toBe("77");
      expect(fact(d, "Summary")).toBe("A summary");
      expect(list(d, "Findings by type")).toEqual(["Outdated × 2", "Too vague × 1"]);
      expect(list(d, "Findings by severity")).toEqual(["High × 1", "Medium × 2"]);
      expect(list(d, "Search terms")).toEqual(["vpn", "mfa"]);
      expect(list(d, "Products mentioned (added as tags)")).toEqual(["Okta × 2"]);
    });

    it("omits empty sections and handles an unknown audience", async () => {
      setup({ analysis: analysis({ targetAudience: null, standardizedSummary: null, searchTerms: [] }) });
      const d = await get("analyze");
      expect(fact(d, "Audience")).toBe("unknown");
      expect(fact(d, "Model score of the Markdown")).toBe("–");
      expect(fact(d, "Summary")).toBeUndefined();
      expect(d.lists).toEqual([]);
    });

    it("has no facts before an analysis exists", async () => {
      setup();
      expect((await get("analyze")).facts).toEqual([]);
    });
  });

  describe("enrich", () => {
    it("says it was skipped when no knowledge was saved", async () => {
      setup({ analysis: analysis() });
      expect(fact(await get("enrich"), "Result")).toMatch(/^Skipped/);
    });

    it("reports incidents, contradictions, confidence and recommendations", async () => {
      setup({ analysis: analysis({ enrichmentKnowledge: { incident_analysis: [{ relevant: true }, { relevant: false }, { relevant: true }], contradictions: [{}], recommendations: ["Add steps"], summary: "Sum", confidence: "high" } }) });
      const d = await get("enrich");
      expect(fact(d, "Incidents looked at")).toBe("3");
      expect(fact(d, "Relevant")).toBe("2");
      expect(fact(d, "Contradictions found")).toBe("1");
      expect(fact(d, "Confidence")).toBe("High");
      expect(fact(d, "Summary")).toBe("Sum");
      expect(list(d, "Recommendations")).toEqual(["Add steps"]);
    });

    it("tolerates a sparse knowledge object", async () => {
      setup({ analysis: analysis({ enrichmentKnowledge: {} }) });
      const d = await get("enrich");
      expect(fact(d, "Incidents looked at")).toBe("0");
      expect(fact(d, "Confidence")).toBe("unknown");
      expect(d.lists).toEqual([]);
    });
  });

  describe("rewrite", () => {
    it("says no rewrite was made when there is none", async () => {
      setup({ analysis: analysis({ findings: [{ type: "x", severity: "low", state: "new" }] }), snaps: [snap("converted")] });
      const d = await get("rewrite");
      expect(fact(d, "Result")).toBe("No rewrite was made for this version.");
      expect(list(d, "Finding states")).toEqual(["New × 1"]);
    });

    it("compares the rewrite with the converted version", async () => {
      setup({
        analysis: analysis({ findings: [{ type: "a", severity: "low", state: "resolved" }, { type: "b", severity: "low", state: "new" }, { type: "c", severity: "low", state: "resolved" }] }),
        snaps: [snap("converted", { score: 50, llmScore: 60, wordCount: 100 }), snap("enriched", { score: 80, llmScore: 90, wordCount: 120, processingMessage: "Added steps" })],
      });
      const d = await get("rewrite");
      expect(fact(d, "Size")).toBe("100 words · 3 B → 120 words · 3 B");
      expect(fact(d, "Mechanical score")).toBe("50 → 80 (+30)");
      expect(fact(d, "Model score")).toBe("60 → 90 (+30)");
      expect(fact(d, "What changed")).toBe("Added steps");
      expect(list(d, "Finding states")).toEqual(["Resolved × 2", "New × 1"]);
    });

    it("works without an analysis", async () => {
      setup();
      const d = await get("rewrite");
      expect(d.lists).toEqual([]);
    });
  });

  describe("ready", () => {
    it("shows the final size, scores and chunks, preferring the rewrite", async () => {
      setup({
        analysis: analysis(), snaps: [snap("converted", { score: 1 }), snap("enriched", { score: 82, llmScore: 91, wordCount: 1000, content: "z".repeat(1536) })],
        chunks: [{ variant: "original", _count: 4 }, { variant: "refined", _count: 6 }],
      });
      const d = await get("ready");
      expect(fact(d, "Final size")).toBe("1,000 words · 1.5 KB");
      expect(fact(d, "Final scores")).toBe("82 mechanical · 91 model");
      expect(fact(d, "Search chunks")).toBe("4 original · 6 refined");
    });

    it("falls back to the converted version and says when there are no chunks", async () => {
      setup({ analysis: analysis(), snaps: [snap("converted", { score: 5, llmScore: null })] });
      const d = await get("ready");
      expect(fact(d, "Final scores")).toBe("5 mechanical · – model");
      expect(fact(d, "Search chunks")).toBe("None yet");
    });

    it("shows dashes before any snapshot exists", async () => {
      setup();
      const d = await get("ready");
      expect(fact(d, "Final size")).toBe("–");
      expect(fact(d, "Final scores")).toBe("– mechanical · – model");
    });
  });

  describe("runs and errors", () => {
    it("lists recent runs of the stage, naming ready's run index", async () => {
      setup({ runs: [{ status: "ok", durationMs: 1500, startedAt: new Date("2026-01-01T10:20:30Z") }, { status: "error", durationMs: 500, startedAt: new Date("2026-01-01T09:00:00Z") }] });
      const d = await get("convert");
      expect(d.runs).toEqual([
        { status: "Done", duration: expect.any(String), startedAt: "2026-01-01 10:20 UTC" },
        { status: "Failed", duration: expect.any(String), startedAt: "2026-01-01 09:00 UTC" },
      ]);
      expect(h.db.stageRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { articleId: "a1", stage: "convert" }, take: 5, orderBy: { startedAt: "desc" } }));
      await get("ready");
      expect(h.db.stageRun.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { articleId: "a1", stage: "index" } }));
    });

    it("does not look up runs for the import step", async () => {
      setup();
      expect((await get("import")).runs).toEqual([]);
      expect(h.db.stageRun.findMany).not.toHaveBeenCalled();
    });

    it("reports the error only on the stage that failed", async () => {
      setup({ item: { status: "failed", failedStage: "analyze", message: "Model offline" } });
      expect((await get("analyze")).error).toBe("Model offline");
      expect((await get("convert")).error).toBeNull();
      expect((await get("rewrite")).error).toBeNull();
    });

    it("blames convert when no failed stage was recorded", async () => {
      setup({ item: { status: "failed", failedStage: null, message: "x" } });
      expect((await get("convert")).error).toBe("x");
    });

    it("uses a placeholder when a failed item has no message", async () => {
      setup({ item: { status: "failed", failedStage: "enrich", message: null } });
      expect((await get("enrich")).error).toBe("No error message was recorded.");
    });

    it("reports no error when the latest item did not fail", async () => {
      setup({ item: { status: "completed", failedStage: "analyze", message: "old" } });
      expect((await get("analyze")).error).toBeNull();
    });
  });
});
