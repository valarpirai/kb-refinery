import { db } from "@/lib/db";
import type { SpanKind } from "@/lib/colors";

export interface KindLatency {
  kind: SpanKind;
  spans: number;
  errors: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

const ORDER: SpanKind[] = ["agent", "loop", "model", "tool", "request", "queue", "other"];

/**
 * How long spans take, grouped by kind, since a time.
 * The grouping mirrors `spanKind` in colors.ts. Keep the two in step.
 * @param since earliest span start to include
 * @return one row per kind that has spans, durations in milliseconds
 */
export async function getKindLatency(since: Date): Promise<KindLatency[]> {
  const rows = await db.$queryRaw<{ kind: SpanKind; spans: number; errors: number; p50: number; p90: number; p95: number; p99: number }[]>`
    SELECT kind,
           count(*)::int AS spans,
           (count(*) FILTER (WHERE status = 'error'))::int AS errors,
           (percentile_cont(0.50) WITHIN GROUP (ORDER BY "durationMs"))::float8 AS p50,
           (percentile_cont(0.90) WITHIN GROUP (ORDER BY "durationMs"))::float8 AS p90,
           (percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"))::float8 AS p95,
           (percentile_cont(0.99) WITHIN GROUP (ORDER BY "durationMs"))::float8 AS p99
    FROM (
      SELECT status, "durationMs",
        CASE
          WHEN name LIKE 'invoke_agent%' THEN 'agent'
          WHEN name = 'execute_agent_loop_cycle' THEN 'loop'
          WHEN name LIKE 'chat %' OR name = 'chat' THEN 'model'
          WHEN name LIKE 'execute_tool %' THEN 'tool'
          WHEN name = 'kb_refinery.agent_chat' THEN 'request'
          WHEN name ~ '^(process|send|complete) ' THEN 'queue'
          ELSE 'other'
        END AS kind
      FROM "TraceSpan" WHERE "startedAt" >= ${since}
    ) s
    GROUP BY kind`;
  return rows.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
