import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { $queryRaw: vi.fn() } }));

import { db } from "@/lib/db";
import { getPipelineMetrics, METRIC_STAGES } from "./metrics";

const q = () => vi.mocked(db.$queryRaw);

/**
 * Queue the three raw query results in the order the module issues them.
 * @param rows per-stage rows
 * @param slow slowest-article rows
 * @param overall overall totals rows
 */
function queue(rows: unknown[], slow: unknown[], overall: unknown[]) {
  q().mockResolvedValueOnce(rows as never).mockResolvedValueOnce(slow as never).mockResolvedValueOnce(overall as never);
}

const row = (stage: string, extra: object = {}) => ({ stage, runs: 2, failed: 1, total: 300, avg: 150, p50: 140, p95: 190, max: 200, ...extra });

describe("getPipelineMetrics", () => {
  const since = new Date("2026-01-01T00:00:00Z");

  it("maps database columns to the public shape", async () => {
    queue([row("convert")], [{ articleId: "a1", title: "T", total: 500, stage: "analyze", ms: 400 }], [{ articles: 2, total: 1000 }]);
    const m = await getPipelineMetrics(since);
    expect(m.stages).toEqual([{ stage: "convert", runs: 2, failed: 1, totalMs: 300, avgMs: 150, p50Ms: 140, p95Ms: 190, maxMs: 200 }]);
    expect(m.slowest).toEqual([{ articleId: "a1", title: "T", totalMs: 500, slowestStage: "analyze", slowestMs: 400 }]);
    expect(m.articles).toBe(2);
    expect(m.totalMs).toBe(1000);
    expect(m.avgArticleMs).toBe(500);
  });

  it("sorts stages in pipeline order and puts unknown stages last", async () => {
    queue([row("index"), row("mystery"), row("rewrite"), row("convert"), row("enrich"), row("analyze")], [], [{ articles: 1, total: 1 }]);
    const m = await getPipelineMetrics(since);
    expect(m.stages.map((s) => s.stage)).toEqual(["convert", "analyze", "enrich", "rewrite", "index", "mystery"]);
  });

  it("exposes the stage order constant", () => {
    expect([...METRIC_STAGES]).toEqual(["convert", "analyze", "enrich", "rewrite", "index"]);
  });

  it("returns zeros and a null average when there is no data", async () => {
    queue([], [], []);
    expect(await getPipelineMetrics(since)).toEqual({ stages: [], slowest: [], articles: 0, avgArticleMs: null, totalMs: 0 });
  });

  it("handles a null total from an empty aggregate", async () => {
    queue([], [], [{ articles: 0, total: null }]);
    const m = await getPipelineMetrics(since);
    expect(m.totalMs).toBe(0);
    expect(m.avgArticleMs).toBeNull();
  });

  it("passes the since date to every query", async () => {
    queue([], [], []);
    await getPipelineMetrics(since);
    expect(q()).toHaveBeenCalledTimes(3);
    for (const call of q().mock.calls) expect((call as unknown[]).slice(1)).toContain(since);
  });

  it("propagates query errors", async () => {
    q().mockRejectedValue(new Error("bad sql"));
    await expect(getPipelineMetrics(since)).rejects.toThrow("bad sql");
  });
});
