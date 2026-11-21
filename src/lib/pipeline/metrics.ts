import { db } from "@/lib/db";

export const METRIC_STAGES = ["convert", "analyze", "enrich", "rewrite", "index"] as const;
export type MetricStage = (typeof METRIC_STAGES)[number];

export interface StageStat {
  stage: string;
  runs: number;
  failed: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface SlowArticle {
  articleId: string;
  title: string;
  totalMs: number;
  slowestStage: string;
  slowestMs: number;
}

export interface PipelineMetrics {
  stages: StageStat[];
  slowest: SlowArticle[];
  articles: number;
  avgArticleMs: number | null;
  totalMs: number;
}

/**
 * Summarise how long each pipeline stage takes since a time.
 * A stage run that failed counts toward time spent and toward the failure count.
 * @param since earliest stage start to include
 * @return per-stage numbers, the slowest articles and overall totals
 */
export async function getPipelineMetrics(since: Date): Promise<PipelineMetrics> {
  const [rows, slow, overall] = await Promise.all([
    db.$queryRaw<{ stage: string; runs: number; failed: number; total: number; avg: number; p50: number; p95: number; max: number }[]>`
      SELECT stage,
             count(*)::int AS runs,
             (count(*) FILTER (WHERE status = 'error'))::int AS failed,
             sum("durationMs")::float8 AS total,
             avg("durationMs")::float8 AS avg,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs"))::float8 AS p50,
             (percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"))::float8 AS p95,
             max("durationMs")::float8 AS max
      FROM "StageRun" WHERE "startedAt" >= ${since}
      GROUP BY stage`,
    db.$queryRaw<{ articleId: string; title: string; total: number; stage: string; ms: number }[]>`
      SELECT t."articleId", a.title, t.total::float8 AS total, w.stage, w."durationMs"::float8 AS ms
      FROM (
        SELECT "articleId", sum("durationMs") AS total
        FROM "StageRun" WHERE "startedAt" >= ${since}
        GROUP BY "articleId" ORDER BY total DESC LIMIT 10
      ) t
      JOIN "Article" a ON a.id = t."articleId"
      JOIN LATERAL (
        SELECT stage, "durationMs" FROM "StageRun"
        WHERE "articleId" = t."articleId" AND "startedAt" >= ${since}
        ORDER BY "durationMs" DESC LIMIT 1
      ) w ON TRUE
      ORDER BY t.total DESC`,
    db.$queryRaw<{ articles: number; total: number | null }[]>`
      SELECT count(DISTINCT "articleId")::int AS articles, sum("durationMs")::float8 AS total
      FROM "StageRun" WHERE "startedAt" >= ${since}`,
  ]);

  const order = (s: string) => {
    const i = (METRIC_STAGES as readonly string[]).indexOf(s);
    return i < 0 ? 99 : i;
  };
  const articles = overall[0]?.articles ?? 0;
  const totalMs = overall[0]?.total ?? 0;
  return {
    stages: rows
      .map((r) => ({ stage: r.stage, runs: r.runs, failed: r.failed, totalMs: r.total, avgMs: r.avg, p50Ms: r.p50, p95Ms: r.p95, maxMs: r.max }))
      .sort((a, b) => order(a.stage) - order(b.stage)),
    slowest: slow.map((s) => ({ articleId: s.articleId, title: s.title, totalMs: s.total, slowestStage: s.stage, slowestMs: s.ms })),
    articles,
    avgArticleMs: articles ? totalMs / articles : null,
    totalMs,
  };
}
