import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/session";

export interface DayRow {
  day: Date;
  runs: number;
  failed: number;
}

export interface ToolRow {
  tool: string;
  calls: number;
  errors: number;
  avgMs: number | null;
}

export interface Totals {
  runs: number;
  completed: number;
  failed: number;
  tokens: number | null;
  avgRunMs: number | null;
}

export interface AgentUsage {
  totals: Totals;
  days: DayRow[];
  tools: ToolRow[];
}

/**
 * Agent runs are assistant chat messages that carry a trace id.
 * Admins see everyone's runs. Other users see their own.
 * @param user who is looking
 * @param since earliest message time
 * @return SQL for a WHERE clause over `m` (ChatMessage) and `c` (Conversation)
 */
function runFilter(user: SessionUser, since: Date): Prisma.Sql {
  const parts = [Prisma.sql`m.role = 'assistant'`, Prisma.sql`m."traceId" IS NOT NULL`, Prisma.sql`m."createdAt" >= ${since}`];
  if (user.role !== "admin") parts.push(Prisma.sql`c."userId" = ${user.id}`);
  return Prisma.join(parts, " AND ");
}

/**
 * Count agent runs and tool calls since a time.
 * Tool calls come from the record each chat reply keeps. Tokens and run time come from the stored trace.
 * @param user who is looking
 * @param since earliest time to count
 * @return totals, runs per day and per-tool numbers
 */
export async function getAgentUsage(user: SessionUser, since: Date): Promise<AgentUsage> {
  const where = runFilter(user, since);

  const [days, tools, spans] = await Promise.all([
    db.$queryRaw<DayRow[]>`
      SELECT date_trunc('day', m."createdAt") AS day,
             count(*)::int AS runs,
             (count(*) FILTER (WHERE m.status = 'failed'))::int AS failed
      FROM "ChatMessage" m JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE ${where}
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ tool: string; calls: number; errors: number; avg_ms: number | null }[]>`
      SELECT t->>'name' AS tool,
             count(*)::int AS calls,
             (count(*) FILTER (WHERE t->>'status' = 'error'))::int AS errors,
             (avg(extract(epoch FROM ((t->>'endedAt')::timestamptz - (t->>'startedAt')::timestamptz)) * 1000)
               FILTER (WHERE t->>'endedAt' IS NOT NULL))::float8 AS avg_ms
      FROM "ChatMessage" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      CROSS JOIN LATERAL jsonb_array_elements(m."toolCalls") t
      WHERE ${where}
      GROUP BY 1 ORDER BY calls DESC`,
    db.$queryRaw<{ tokens: number | null; avg_ms: number | null }[]>`
      SELECT sum(x.tok)::float8 AS tokens, avg(x.ms)::float8 AS avg_ms
      FROM (
        SELECT max((s.attributes->>'gen_ai.usage.total_tokens')::numeric) AS tok, max(s."durationMs") AS ms
        FROM "TraceSpan" s
        WHERE s.name LIKE 'invoke_agent%'
          AND s."traceId" IN (
            SELECT m."traceId" FROM "ChatMessage" m JOIN "Conversation" c ON c.id = m."conversationId" WHERE ${where})
        GROUP BY s."traceId"
      ) x`,
  ]);

  const runs = days.reduce((n, d) => n + d.runs, 0);
  const failed = days.reduce((n, d) => n + d.failed, 0);
  return {
    totals: { runs, failed, completed: runs - failed, tokens: spans[0]?.tokens ?? null, avgRunMs: spans[0]?.avg_ms ?? null },
    days,
    tools: tools.map((t) => ({ tool: t.tool, calls: t.calls, errors: t.errors, avgMs: t.avg_ms })),
  };
}
