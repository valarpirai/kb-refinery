import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    article: { findUnique: vi.fn() },
    analysis: { findUnique: vi.fn() },
    jobItem: { findFirst: vi.fn() },
    snapshot: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    stageRun: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: h.db }));
// status.ts only needs the STAGES constant; the real module would pull in the whole pipeline.
vi.mock("./run-article", () => ({ STAGES: ["convert", "analyze", "enrich", "rewrite"] }));

import { getPipelineStatus, type PipelineStatus } from "./status";

const UPDATED = new Date("2026-05-01T10:00:00Z");

/**
 * Prepare the fake database for one article.
 * @param o.item latest job item, or null
 * @param o.analysis the analysis, or null
 * @param o.snaps snapshots of the newest version
 * @param o.runs stage runs, newest first
 * @param o.body the article body
 */
function setup(o: { item?: Record<string, unknown> | null; analysis?: Record<string, unknown> | null; snaps?: Record<string, unknown>[]; runs?: { stage: string; durationMs: number }[]; body?: string; version?: number } = {}) {
  h.db.article.findUnique.mockResolvedValue({ id: "a1", body: o.body ?? "<p>body</p>" });
  h.db.analysis.findUnique.mockResolvedValue(o.analysis ?? null);
  h.db.jobItem.findFirst.mockResolvedValue(o.item ? { id: "i1", failedStage: null, message: null, restarts: 0, jobId: "j1", updatedAt: UPDATED, ...o.item } : null);
  h.db.stageRun.findMany.mockResolvedValue(o.runs ?? []);
  const snaps = o.snaps ?? [];
  h.db.snapshot.findFirst.mockResolvedValue(snaps.length ? { version: o.version ?? 1 } : null);
  h.db.snapshot.findMany.mockResolvedValue(snaps);
  h.db.snapshot.count.mockImplementation(async () => snaps.filter((s) => s.type === "enriched").length);
}

const states = (s: PipelineStatus) => s.steps.map((x) => `${x.key}:${x.state}`);

describe("getPipelineStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an unknown article", async () => {
    h.db.article.findUnique.mockResolvedValue(null);
    expect(await getPipelineStatus("nope")).toBeNull();
    expect(h.db.analysis.findUnique).not.toHaveBeenCalled();
  });

  it("shows only the import step done for an article that was never refined", async () => {
    setup();
    const s = (await getPipelineStatus("a1"))!;
    expect(states(s)).toEqual(["import:done", "convert:pending", "analyze:pending", "enrich:pending", "rewrite:pending", "ready:pending"]);
    expect(s).toMatchObject({ articleId: "a1", analysisId: null, running: false, item: null, restartFrom: [] });
    expect(s.steps.map((x) => x.label)).toEqual(["Imported", "Convert", "Analyze", "Enrich", "Rewrite", "Ready"]);
  });

  it.each([
    ["converting", ["convert:active", "analyze:pending", "enrich:pending", "rewrite:pending"]],
    ["analyzing", ["convert:done", "analyze:active", "enrich:pending", "rewrite:pending"]],
    ["enriching", ["convert:done", "analyze:done", "enrich:active", "rewrite:pending"]],
    ["scoring", ["convert:done", "analyze:done", "enrich:done", "rewrite:active"]],
  ])("marks the active stage for a %s item", async (status, expected) => {
    setup({ item: { status } });
    const s = (await getPipelineStatus("a1"))!;
    expect(states(s).slice(1, 5)).toEqual(expected);
    expect(s.running).toBe(true);
    expect(s.restartFrom).toEqual([]);
    expect(s.steps.at(-1)!.state).toBe("pending");
  });

  it("queues convert for a fresh pending item", async () => {
    setup({ item: { status: "pending" } });
    const s = (await getPipelineStatus("a1"))!;
    expect(states(s).slice(1, 5)).toEqual(["convert:queued", "analyze:pending", "enrich:pending", "rewrite:pending"]);
    expect(s.running).toBe(true);
  });

  it("queues at the resume point for a restarted pending item", async () => {
    setup({ item: { status: "pending", failedStage: "enrich" } });
    const s = (await getPipelineStatus("a1"))!;
    expect(states(s).slice(1, 5)).toEqual(["convert:done", "analyze:done", "enrich:queued", "rewrite:pending"]);
    expect(s.item!.failedStage).toBe("enrich");
  });

  it("shows the failed stage and offers a restart from it or any earlier stage", async () => {
    setup({ item: { status: "failed", failedStage: "enrich", message: "boom" } });
    const s = (await getPipelineStatus("a1"))!;
    expect(states(s).slice(1, 5)).toEqual(["convert:done", "analyze:done", "enrich:failed", "rewrite:pending"]);
    expect(s.restartFrom).toEqual(["convert", "analyze", "enrich"]);
    expect(s.running).toBe(false);
    expect(s.item).toMatchObject({ status: "failed", message: "boom" });
  });

  it("treats a failure with no recorded stage as a convert failure", async () => {
    setup({ item: { status: "failed" } });
    const s = (await getPipelineStatus("a1"))!;
    expect(states(s)[1]).toBe("convert:failed");
    expect(s.restartFrom).toEqual(["convert"]);
  });

  it("lets the item state win over a stale ready analysis", async () => {
    setup({ item: { status: "analyzing" }, analysis: { id: "an1", pipelineStage: "ready" } });
    expect((await getPipelineStatus("a1"))!.steps[2].state).toBe("active");
  });

  describe("a finished article", () => {
    const analysis = (extra = {}) => ({ id: "an1", pipelineStage: "ready", enrichmentKnowledge: { confidence: "high" }, ...extra });
    const snap = (type: string) => ({ type, score: 50, llmScore: 60, wordCount: 10, content: "abc" });

    it("shows every stage done when it was enriched and rewritten", async () => {
      setup({ item: { status: "completed" }, analysis: analysis(), snaps: [snap("raw"), snap("converted"), snap("enriched")] });
      const s = (await getPipelineStatus("a1"))!;
      expect(states(s).slice(1)).toEqual(["convert:done", "analyze:done", "enrich:done", "rewrite:done", "ready:done"]);
      expect(s.running).toBe(false);
      expect(s.restartFrom).toEqual([]);
      expect(s.analysisId).toBe("an1");
    });

    it("skips enrich when no enrichment knowledge was saved", async () => {
      setup({ analysis: analysis({ enrichmentKnowledge: null }), snaps: [snap("converted"), snap("enriched")] });
      expect(states((await getPipelineStatus("a1"))!)).toContain("enrich:skipped");
    });

    it("skips rewrite when the newest version has no rewrite", async () => {
      setup({ analysis: analysis(), snaps: [snap("raw"), snap("converted")] });
      const s = (await getPipelineStatus("a1"))!;
      expect(states(s)).toContain("rewrite:skipped");
      expect(states(s)).toContain("ready:done");
    });

    it("skips rewrite when there are no snapshots at all", async () => {
      setup({ analysis: analysis(), snaps: [] });
      expect(states((await getPipelineStatus("a1"))!)).toContain("rewrite:skipped");
    });

    it("leaves steps pending when the analysis is not ready and no item exists", async () => {
      setup({ analysis: { id: "an1", pipelineStage: "analyzing" } });
      expect(states((await getPipelineStatus("a1"))!).slice(1)).toEqual(["convert:pending", "analyze:pending", "enrich:pending", "rewrite:pending", "ready:pending"]);
    });
  });

  describe("step details", () => {
    const snap = (type: string, extra = {}) => ({ type, score: 55, llmScore: 70, wordCount: 12, content: "héllo", ...extra });
    const detailOf = async (key: string) => (await getPipelineStatus("a1"))!.steps.find((x) => x.key === key)!.detail!;

    it("reads time from the latest run of each stage", async () => {
      setup({ runs: [{ stage: "analyze", durationMs: 30 }, { stage: "analyze", durationMs: 999 }, { stage: "convert", durationMs: 5 }] });
      expect((await detailOf("analyze")).durationMs).toBe(30);
      expect((await detailOf("convert")).durationMs).toBe(5);
      expect((await detailOf("enrich")).durationMs).toBeNull();
    });

    it("takes scores, words and bytes from the snapshot and counts bytes, not characters", async () => {
      setup({ analysis: { id: "an1", pipelineStage: "ready" }, snaps: [snap("converted")] });
      expect(await detailOf("convert")).toEqual({ durationMs: null, mechanical: 55, model: 70, words: 12, bytes: 6 });
    });

    it("falls back to the article body for the import step when there is no raw snapshot", async () => {
      setup({ body: "abcd" });
      expect(await detailOf("import")).toEqual({ durationMs: null, mechanical: null, model: null, words: null, bytes: 4 });
    });

    it("uses the raw snapshot for import when present", async () => {
      setup({ analysis: { id: "an1" }, snaps: [snap("raw", { content: "xx" })], body: "longer body" });
      expect((await detailOf("import")).bytes).toBe(2);
    });

    it("has no size for rewrite when there is no rewrite", async () => {
      setup({ analysis: { id: "an1" }, snaps: [snap("converted")] });
      expect(await detailOf("rewrite")).toMatchObject({ mechanical: null, bytes: null });
    });

    it("gives analyze and enrich a time but no content numbers", async () => {
      setup({ runs: [{ stage: "enrich", durationMs: 9 }], analysis: { id: "an1" }, snaps: [snap("converted")] });
      expect(await detailOf("enrich")).toEqual({ durationMs: 9, mechanical: null, model: null, words: null, bytes: null });
    });

    it("shows the ready step with the total of each stage's latest run and the final content", async () => {
      setup({
        runs: [{ stage: "convert", durationMs: 10 }, { stage: "convert", durationMs: 500 }, { stage: "analyze", durationMs: 20 }, { stage: "index", durationMs: 5 }],
        analysis: { id: "an1" }, snaps: [snap("converted", { score: 1 }), snap("enriched", { score: 99 })],
      });
      expect(await detailOf("ready")).toMatchObject({ durationMs: 35, mechanical: 99 });
    });

    it("shows the ready step from the converted snapshot when nothing was rewritten, and no total without runs", async () => {
      setup({ analysis: { id: "an1" }, snaps: [snap("converted", { score: 7 })] });
      expect(await detailOf("ready")).toMatchObject({ durationMs: null, mechanical: 7 });
    });

    it("tolerates an analysis with no snapshots", async () => {
      setup({ analysis: { id: "an1" }, snaps: [] });
      expect((await detailOf("convert")).bytes).toBeNull();
    });
  });

  it("formats the item timestamp as ISO", async () => {
    setup({ item: { status: "pending" } });
    expect((await getPipelineStatus("a1"))!.item!.updatedAt).toBe("2026-05-01T10:00:00.000Z");
  });
});
