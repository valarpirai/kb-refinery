import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    job: { findFirst: vi.fn() },
    article: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    snapshot: { groupBy: vi.fn() },
    jobItem: { findFirst: vi.fn() },
    analysis: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: h.db }));

import { getRefiningPath, type RefiningPath } from ".././path";

interface Setup {
  job?: Record<string, unknown> | null;
  total?: number;
  buckets?: Record<string, number>;
  picks?: Record<string, unknown>[];
  scores?: { type: string; _avg: { score: number | null } }[];
  item?: Record<string, unknown> | null;
  body?: string | null;
  analysis?: Record<string, unknown> | null;
}

/**
 * Prepare the fake database.
 * @param o what each query should return
 */
function setup(o: Setup = {}) {
  h.db.job.findFirst.mockResolvedValue(o.job === undefined ? null : o.job);
  h.db.article.count.mockResolvedValue(o.total ?? 0);
  h.db.$queryRaw.mockResolvedValue(Object.entries(o.buckets ?? {}).map(([bucket, n]) => ({ bucket, n })));
  h.db.article.findMany.mockResolvedValue(o.picks ?? []);
  h.db.snapshot.groupBy.mockResolvedValue(o.scores ?? []);
  h.db.jobItem.findFirst.mockResolvedValue(o.item ?? null);
  h.db.article.findUnique.mockResolvedValue(o.body == null ? null : { body: o.body });
  h.db.analysis.findUnique.mockResolvedValue(o.analysis ?? null);
}

const pick = (id: string, itemStatus?: string, stage?: string, findings = 0) => ({
  id, title: `T-${id}`,
  analysis: stage ? { pipelineStage: stage, _count: { findings } } : null,
  jobItems: itemStatus ? [{ status: itemStatus }] : [],
});
const stageOf = (p: RefiningPath, id: string) => p.articles.find((a) => a.id === id)!.stage;
const ring = (p: RefiningPath, id: string) => p.stages.find((s) => s.id === id)!;

describe("getRefiningPath: counts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty path when there are no articles", async () => {
    setup();
    const p = await getRefiningPath();
    expect(p.stages.map((s) => s.id)).toEqual(["ingested", "converted", "analyzed", "enriching", "ready"]);
    expect(p.stages.every((s) => s.count === 0 && s.progress === 0)).toBe(true);
    expect(p.exits).toEqual([{ id: "no_gaps", name: "No gaps found", count: 0, share: 0 }, { id: "failed", name: "Failed", count: 0, share: 0 }]);
    expect(p.stats).toEqual({ onPath: 0, ready: 0, working: 0, leftEarly: 0 });
    expect(p).toMatchObject({ job: null, sourceCount: 0, notRefined: 0, live: false, selectedArticleId: "", here: null, steps: null, article: null, sizes: null });
    expect(p.scoreTrack).toEqual({ raw: null, converted: null, enriched: null });
  });

  it("maps buckets onto rings, exits and stats", async () => {
    setup({ total: 40, buckets: { pending: 4, converting: 3, analyzing: 2, enriching: 1, completed: 20, noGaps: 6, failed: 4, notRefined: 5 } });
    const p = await getRefiningPath();
    expect(p.stages.map((s) => s.count)).toEqual([4, 3, 2, 1, 20]);
    expect(p.exits.map((e) => e.count)).toEqual([6, 4]);
    expect(p.stats).toEqual({ onPath: 4 + 6, ready: 20, working: 6, leftEarly: 10 });
    expect(p.notRefined).toBe(5);
    expect(p.sourceCount).toBe(40);
    expect(p.live).toBe(true);
  });

  it("computes ring arcs as shares of the refined articles, excluding never-refined ones", async () => {
    setup({ buckets: { pending: 1, completed: 3, notRefined: 100 } });
    const p = await getRefiningPath();
    expect(ring(p, "ingested").progress).toBe(0.25);
    expect(ring(p, "ready").progress).toBe(0.75);
  });

  it("is not live when only finished work exists", async () => {
    setup({ buckets: { completed: 2, noGaps: 1, failed: 1 } });
    expect((await getRefiningPath()).live).toBe(false);
  });

  it("is live while something is queued or being worked on", async () => {
    setup({ buckets: { pending: 1 } });
    expect((await getRefiningPath()).live).toBe(true);
    setup({ buckets: { analyzing: 1 } });
    expect((await getRefiningPath()).live).toBe(true);
  });

  it("reports the latest job's counters", async () => {
    setup({ job: { id: "j9", articlesProcessed: 7, articlesSkipped: 2 } });
    expect((await getRefiningPath()).job).toEqual({ id: "j9", processed: 7, skipped: 2 });
  });

  it("averages snapshot scores by type, rounded, when no article is chosen", async () => {
    setup({ scores: [{ type: "raw", _avg: { score: 40.4 } }, { type: "converted", _avg: { score: 55.5 } }, { type: "enriched", _avg: { score: null } }] });
    expect((await getRefiningPath()).scoreTrack).toEqual({ raw: 40, converted: 56, enriched: null });
  });
});

describe("getRefiningPath: article list", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["pending", undefined, 0, "ingested", "Queued"],
    ["converting", undefined, 0, "converted", "Converting"],
    ["analyzing", undefined, 0, "analyzed", "Analyzing"],
    ["enriching", undefined, 0, "enriching", "Enriching"],
    ["scoring", undefined, 0, "enriching", "Enriching"],
    ["completed", "ready", 2, "ready", "AI-ready"],
    ["completed", "ready", 0, "no_gaps", "No gaps found"],
    ["failed", "failed", 0, "failed", "Failed"],
    ["failed", undefined, 0, "failed", "Failed"],
    ["completed", "failed", 0, "failed", "Failed"],
    [undefined, undefined, 0, "source", "Not refined yet"],
    [undefined, "analyzing", 0, "ingested", "Queued"],
  ])("places an article with item %s and stage %s (%i findings) at %s", async (item, stage, findings, place, label) => {
    setup({ picks: [pick("x", item, stage, findings)] });
    const a = (await getRefiningPath()).articles[0];
    expect(a).toMatchObject({ id: "x", title: "T-x", stage: place, label });
  });

  it("lets an active item win over a stale ready stage", async () => {
    setup({ picks: [pick("x", "analyzing", "ready", 3)] });
    expect(stageOf(await getRefiningPath(), "x")).toBe("analyzed");
  });

  it("lists articles being worked on first, keeping order otherwise", async () => {
    setup({ picks: [pick("done", "completed", "ready", 1), pick("new"), pick("busy", "analyzing"), pick("queued", "pending"), pick("fail", "failed", "failed")] });
    expect((await getRefiningPath()).articles.map((a) => a.id)).toEqual(["busy", "queued", "done", "new", "fail"]);
  });
});

describe("getRefiningPath: a chosen article", () => {
  beforeEach(() => vi.clearAllMocks());

  const snapshots = [
    { version: 2, type: "enriched", content: "final text", score: 90, llmScore: 95 },
    { version: 2, type: "converted", content: "converted text é", score: 70, llmScore: 75 },
    { version: 2, type: "raw", content: "raw", score: 50, llmScore: 55 },
    { version: 1, type: "raw", content: "old raw", score: 10, llmScore: 11 },
  ];
  const analysis = (extra = {}) => ({
    id: "an1", targetAudience: "end_user", searchTerms: ["a", "b", "c", "d", "e", "f", "g"], enrichmentKnowledge: null,
    findings: [{ severity: "high", type: "too_vague" }, { severity: null, type: "no_resolution_steps" }], snapshots, ...extra,
  });

  it("ignores an unknown article id and shows counts", async () => {
    setup({ picks: [pick("x")] });
    const p = await getRefiningPath("ghost");
    expect(p.selectedArticleId).toBe("");
    expect(p.steps).toBeNull();
    expect(h.db.analysis.findUnique).not.toHaveBeenCalled();
  });

  it("selects the article and reports where it is", async () => {
    setup({ picks: [pick("x", "analyzing", "analyzing")], item: { status: "analyzing", failedStage: null }, body: "body", analysis: analysis() });
    const p = await getRefiningPath("x");
    expect(p.selectedArticleId).toBe("x");
    expect(p.here).toEqual({ stage: "analyzed", label: "Analyzing" });
    expect(p.article).toEqual({ id: "x", title: "T-x", analysisId: "an1" });
    expect(p.steps).toEqual({ ingested: "done", converted: "done", analyzed: "active", enriching: "waiting", ready: "waiting" });
  });

  it("measures sizes in bytes for the newest version", async () => {
    setup({ picks: [pick("x", "completed", "ready", 1)], body: "twelve bytes", analysis: analysis() });
    const p = await getRefiningPath("x");
    expect(p.sizes).toEqual({ original: 12, converted: Buffer.byteLength("converted text é"), rewritten: 10 });
  });

  it("leaves sizes null for versions that do not exist", async () => {
    setup({ picks: [pick("x")], body: null, analysis: null });
    expect((await getRefiningPath("x"))!.sizes).toEqual({ original: null, converted: null, rewritten: null });
  });

  it("uses the chosen article's own newest-version scores for the score track", async () => {
    setup({ picks: [pick("x", "completed", "ready", 1)], body: "b", analysis: analysis(), scores: [{ type: "raw", _avg: { score: 1 } }] });
    expect((await getRefiningPath("x")).scoreTrack).toEqual({ raw: 50, converted: 70, enriched: 90 });
  });

  it("builds the ring examples from the saved snapshots", async () => {
    setup({ picks: [pick("x", "completed", "ready", 1)], body: "b", analysis: analysis(), job: { id: "j", articlesProcessed: 3, articlesSkipped: 1 } });
    const p = await getRefiningPath("x");
    expect(ring(p, "ingested").example!.in.text).toBe("raw");
    expect(ring(p, "ingested").example!.out.items).toContainEqual({ label: "mechanical score", text: "50 / 100" });
    expect(ring(p, "ingested").example!.out.items).toContainEqual({ label: "latest run", text: "3 processed, 1 skipped" });
    expect(ring(p, "converted").example!.out).toMatchObject({ caption: "mechanical score 70", text: "converted text é" });
    expect(ring(p, "ready").example).toMatchObject({ in: { text: "raw" }, out: { text: "final text", caption: "mechanical score 90" } });
  });

  it("describes analysis findings and classification", async () => {
    setup({ picks: [pick("x", "completed", "ready", 1)], body: "b", analysis: analysis() });
    const ex = ring(await getRefiningPath("x"), "analyzed").example!;
    expect(ex.in).toMatchObject({ caption: "2 open", items: [{ label: "high", text: "too vague" }, { label: "unrated", text: "no resolution steps" }] });
    expect(ex.out.items).toEqual([
      { label: "audience", text: "end user" },
      { label: "search terms", text: "a, b, c, d, e" },
      { label: "model score", text: "75 / 100" },
    ]);
  });

  it("says there are no findings when the list is empty", async () => {
    setup({ picks: [pick("x", "completed", "ready", 0)], body: "b", analysis: analysis({ findings: [] }) });
    expect(ring(await getRefiningPath("x"), "analyzed").example!.in.items).toEqual([{ label: "none", text: "no findings" }]);
  });

  it("shows the enrichment example only when knowledge was saved", async () => {
    setup({ picks: [pick("x", "completed", "ready", 1)], body: "b", analysis: analysis() });
    const without = await getRefiningPath("x");
    expect(ring(without, "enriching").example).toBeNull();
    expect(ring(without, "enriching").emptyMessage).toMatch(/no content gap/);
    setup({ picks: [pick("x", "completed", "ready", 1)], body: "b", analysis: analysis({ enrichmentKnowledge: { incident_analysis: [{ relevant: true }, { relevant: false }], summary: "", confidence: "high", recommendations: ["r1", "r2", "r3", "r4"] } }) });
    const ex = ring(await getRefiningPath("x"), "enriching").example!;
    expect(ex.in.items).toEqual([{ label: "looked at", text: "2" }, { label: "relevant", text: "1" }]);
    expect(ex.out.caption).toBe("confidence: high");
    expect(ex.out.items).toEqual([{ label: "summary", text: "none" }, { label: "advice", text: "r1" }, { label: "advice", text: "r2" }, { label: "advice", text: "r3" }]);
  });

  it("truncates long previews to 900 characters with an ellipsis", async () => {
    const long = [{ version: 1, type: "raw", content: "x".repeat(2000), score: 1, llmScore: 1 }];
    setup({ picks: [pick("x", "completed", "ready", 1)], body: "b", analysis: analysis({ snapshots: long }) });
    const text = ring(await getRefiningPath("x"), "ingested").example!.in.text!;
    expect(text).toHaveLength(901);
    expect(text.endsWith("…")).toBe(true);
  });

  it("has no examples before the article has any snapshot", async () => {
    setup({ picks: [pick("x")], body: "b", analysis: null });
    const p = await getRefiningPath("x");
    expect(p.stages.every((s) => s.example === null)).toBe(true);
    expect(ring(p, "converted").emptyMessage).toBe("This article has not been converted yet.");
    expect(p.steps).toEqual({ ingested: "waiting", converted: "waiting", analyzed: "waiting", enriching: "waiting", ready: "waiting" });
  });

  it.each([
    ["skipped", "Skipped, unchanged since the last run"],
    ["pending", "Queued for conversion"],
    ["completed", "Now: completed"],
    [undefined, "Now: not in this run"],
  ])("explains an item in state %s", async (status, text) => {
    setup({ picks: [pick("x", status ?? undefined, "ready", 1)], item: status ? { status } : null, body: "b", analysis: analysis() });
    const items = ring(await getRefiningPath("x"), "ingested").example!.out.items!;
    expect(items.find((i) => i.label === "this article")!.text).toBe(text);
  });

  describe("steps by place", () => {
    const stepsFor = async (item: string | undefined, stage: string | undefined, findings: number, failedStage: string | null = null) => {
      setup({ picks: [pick("x", item, stage, findings)], item: item ? { status: item, failedStage } : null, body: "b" });
      return (await getRefiningPath("x")).steps!;
    };

    it("marks every step done for an AI-ready article", async () => {
      expect(Object.values(await stepsFor("completed", "ready", 2))).toEqual(["done", "done", "done", "done", "done"]);
    });

    it("skips enrichment and ready when no gaps were found", async () => {
      expect(await stepsFor("completed", "ready", 0)).toEqual({ ingested: "done", converted: "done", analyzed: "done", enriching: "skipped", ready: "skipped" });
    });

    it("queues the first step for a pending item", async () => {
      expect(await stepsFor("pending", undefined, 0)).toMatchObject({ ingested: "queued", converted: "waiting" });
    });

    it.each([
      ["convert", { ingested: "done", converted: "failed", analyzed: "waiting" }],
      ["analyze", { ingested: "done", converted: "done", analyzed: "failed", enriching: "waiting" }],
      ["enrich", { analyzed: "done", enriching: "failed", ready: "waiting" }],
      ["rewrite", { analyzed: "done", enriching: "failed", ready: "waiting" }],
    ])("marks the failed step for a %s failure", async (failedStage, expected) => {
      expect(await stepsFor("failed", "failed", 0, failedStage)).toMatchObject(expected);
    });

    it("marks the first step failed when the failed stage is unknown", async () => {
      expect(await stepsFor("failed", "failed", 0, null)).toMatchObject({ ingested: "failed", converted: "waiting" });
    });

    it("marks everything waiting for an article that was never refined", async () => {
      expect(Object.values(await stepsFor(undefined, undefined, 0))).toEqual(["waiting", "waiting", "waiting", "waiting", "waiting"]);
    });
  });
});
