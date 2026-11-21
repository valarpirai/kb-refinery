import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { formatDuration } from "@/lib/agent/trace-format";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const RANGES = [
  { value: "1h", label: "Last hour", ms: 3_600_000 },
  { value: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
  { value: "all", label: "All time", ms: 0 },
] as const;

type Params = { type?: string; range?: string; status?: string; tool?: string; q?: string; min?: string; page?: string };

interface Row {
  traceId: string;
  started: Date;
  spans: number;
  errors: number;
  tools: number;
  model_calls: number;
  agent_ms: number | null;
  total_ms: number;
  tokens: number | null;
  is_agent: boolean;
  conversation_id: string | null;
  tool_names: string[] | null;
  root_name: string | null;
}

const field = "rounded border border-black/20 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent";

export default async function TracesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePageUser();
  if (user.role !== "admin") notFound();

  const p = await searchParams;
  const type = p.type === "all" ? "all" : "agent";
  const range = RANGES.find((r) => r.value === p.range) ?? RANGES[2];
  const status = p.status === "error" || p.status === "ok" ? p.status : "all";
  const q = (p.q ?? "").trim().slice(0, 100);
  const tool = (p.tool ?? "").trim();
  const minSeconds = Math.max(0, Number(p.min) || 0);
  const page = Math.max(1, Math.floor(Number(p.page) || 1));

  const since = range.ms ? new Date(Date.now() - range.ms) : new Date(0);
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (type === "agent") conditions.push(Prisma.sql`is_agent`);
  if (status === "error") conditions.push(Prisma.sql`errors > 0`);
  if (status === "ok") conditions.push(Prisma.sql`errors = 0`);
  if (tool) conditions.push(Prisma.sql`tool_names @> ARRAY[${tool}]::text[]`);
  if (minSeconds > 0) conditions.push(Prisma.sql`COALESCE(agent_ms, total_ms) >= ${minSeconds * 1000}`);
  const where = Prisma.join(conditions, " AND ");
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const textFilter = q
    ? Prisma.sql`AND "traceId" IN (SELECT "traceId" FROM "TraceSpan" WHERE name ILIKE ${like} OR attributes::text ILIKE ${like})`
    : Prisma.empty;

  const aggregate = Prisma.sql`
    SELECT "traceId",
      min("startedAt") AS started,
      count(*)::int AS spans,
      (count(*) FILTER (WHERE status = 'error'))::int AS errors,
      (count(*) FILTER (WHERE name LIKE 'execute_tool %'))::int AS tools,
      (count(*) FILTER (WHERE name LIKE 'chat %'))::int AS model_calls,
      max("durationMs") FILTER (WHERE name LIKE 'invoke_agent%') AS agent_ms,
      max("durationMs") AS total_ms,
      max((attributes->>'gen_ai.usage.total_tokens')::numeric) FILTER (WHERE name LIKE 'invoke_agent%') AS tokens,
      COALESCE(bool_or(name LIKE 'invoke_agent%'), false) AS is_agent,
      max(attributes->>'kb.conversation_id') AS conversation_id,
      array_remove(array_agg(DISTINCT substr(name, 14)) FILTER (WHERE name LIKE 'execute_tool %'), NULL) AS tool_names,
      (array_agg(name ORDER BY "startedAt") FILTER (WHERE "parentId" IS NULL))[1] AS root_name
    FROM "TraceSpan"
    WHERE "startedAt" >= ${since} ${textFilter}
    GROUP BY "traceId"`;

  const [rows, countRows, toolRows] = await Promise.all([
    db.$queryRaw<Row[]>`SELECT * FROM (${aggregate}) a WHERE ${where} ORDER BY started DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM (${aggregate}) a WHERE ${where}`,
    db.$queryRaw<{ tool: string }[]>`SELECT DISTINCT substr(name, 14) AS tool FROM "TraceSpan" WHERE name LIKE 'execute_tool %' ORDER BY 1`,
  ]);
  const total = countRows[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const link = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ type, range: range.value, status, tool, q, min: minSeconds ? String(minSeconds) : "" })) if (v && v !== "all" && !(k === "type" && v === "agent")) sp.set(k, v);
    if (n > 1) sp.set("page", String(n));
    return `/traces${sp.size ? `?${sp}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Traces</h1>
        <p className="mt-1 text-sm opacity-70">What the agent did, step by step: model calls, tool calls, time and tokens. Collected by Traceloop and stored in your database.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-3 dark:border-white/15" aria-label="Filter traces">
        <div className="flex flex-col gap-1">
          <label htmlFor="type" className="text-xs font-medium">Show</label>
          <select id="type" name="type" defaultValue={type} className={field}>
            <option value="agent">Agent runs</option>
            <option value="all">All traces</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="range" className="text-xs font-medium">When</label>
          <select id="range" name="range" defaultValue={range.value} className={field}>
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs font-medium">Status</label>
          <select id="status" name="status" defaultValue={status} className={field}>
            <option value="all">Any</option>
            <option value="ok">No errors</option>
            <option value="error">Has errors</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="tool" className="text-xs font-medium">Used tool</label>
          <select id="tool" name="tool" defaultValue={tool} className={field}>
            <option value="">Any</option>
            {toolRows.map((t) => <option key={t.tool} value={t.tool}>{t.tool}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="min" className="text-xs font-medium">Slower than (seconds)</label>
          <input id="min" name="min" type="number" min={0} defaultValue={minSeconds || ""} className={`${field} w-28`} />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-xs font-medium">Search prompts, answers and names</label>
          <input id="q" name="q" defaultValue={q} maxLength={100} className={field} />
        </div>
        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">Apply</button>
        <Link href="/traces" className="px-2 py-1.5 text-sm underline">Reset</Link>
      </form>

      <p className="text-sm" aria-live="polite">{total} trace{total === 1 ? "" : "s"}</p>

      {rows.length === 0 ? (
        <p className="text-sm opacity-70">No traces match. Ask the agent something in Chat, or widen the filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/10 dark:border-white/15">
              <tr>
                <th className="py-2 pr-4">Started</th>
                <th className="pr-4">Trace</th>
                <th className="pr-4">Time</th>
                <th className="pr-4">Model calls</th>
                <th className="pr-4">Tools</th>
                <th className="pr-4">Tokens</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.traceId} className="border-b border-black/5 align-top dark:border-white/10">
                  <td className="py-2 pr-4 whitespace-nowrap">{r.started.toLocaleString()}</td>
                  <td className="pr-4">
                    <Link href={`/traces/${r.traceId}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">
                      {r.is_agent ? "Agent run" : r.root_name ?? "Trace"}
                    </Link>
                    <span className="block text-xs opacity-70">{r.spans} spans{r.tool_names?.length ? ` · ${r.tool_names.join(", ")}` : ""}</span>
                  </td>
                  <td className="pr-4 whitespace-nowrap">{formatDuration(r.agent_ms ?? r.total_ms)}</td>
                  <td className="pr-4">{r.model_calls}</td>
                  <td className="pr-4">{r.tools}</td>
                  <td className="pr-4">{r.tokens != null ? Number(r.tokens).toLocaleString() : "–"}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.errors > 0 ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"}`}>
                      {r.errors > 0 ? `${r.errors} error${r.errors === 1 ? "" : "s"}` : "OK"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={link(page - 1)} className="underline">← Newer</Link> : <span className="opacity-40">← Newer</span>}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={link(page + 1)} className="underline">Older →</Link> : <span className="opacity-40">Older →</span>}
        </nav>
      )}
    </div>
  );
}
