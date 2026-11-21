import { getAgentUsage } from "@/lib/agent/usage";
import { formatDuration } from "@/lib/agent/trace-format";
import { SPAN_KIND } from "@/lib/colors";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
  { value: "all", label: "All time", ms: 0 },
] as const;

const pct = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((n / d) * 100)}%`);

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {note ? <div className="mt-0.5 text-xs opacity-60">{note}</div> : null}
    </div>
  );
}

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requirePageUser();
  const { range: rangeParam } = await searchParams;
  const range = RANGES.find((r) => r.value === rangeParam) ?? RANGES[1];
  const usage = await getAgentUsage(user, range.ms ? new Date(Date.now() - range.ms) : new Date(0));
  const { totals, days, tools } = usage;
  const maxDay = Math.max(1, ...days.map((d) => d.runs));
  const maxCalls = Math.max(1, ...tools.map((t) => t.calls));
  const toolCalls = tools.reduce((n, t) => n + t.calls, 0);
  const toolErrors = tools.reduce((n, t) => n + t.errors, 0);
  const toolColor = SPAN_KIND.tool.colors;
  const agentColor = SPAN_KIND.agent.colors;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agent usage</h1>
          <p className="mt-1 text-sm opacity-70">
            How much the agent runs and which tools it calls. {user.role === "admin" ? "Counts everyone's chats." : "Counts your own chats."}
          </p>
        </div>
        <nav aria-label="Time range" className="flex gap-1 text-sm">
          {RANGES.map((r) => (
            <a
              key={r.value}
              href={`/agents?range=${r.value}`}
              aria-current={r.value === range.value ? "page" : undefined}
              className={`rounded px-3 py-1.5 ${r.value === range.value ? "bg-black/10 font-medium dark:bg-white/15" : "hover:underline"}`}
            >
              {r.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Agent runs" value={totals.runs.toLocaleString()} note={`${totals.completed} completed, ${totals.failed} failed`} />
        <Tile label="Success rate" value={pct(totals.completed, totals.runs)} />
        <Tile label="Tool calls" value={toolCalls.toLocaleString()} note={`${pct(toolErrors, toolCalls)} errored`} />
        <Tile label="Average run time" value={totals.avgRunMs != null ? formatDuration(totals.avgRunMs) : "–"} note={totals.tokens != null ? `${Math.round(totals.tokens).toLocaleString()} tokens in total` : undefined} />
      </div>

      <section aria-labelledby="runs-heading" className="rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 id="runs-heading" className="font-medium">Runs per day</h2>
        {days.length === 0 ? (
          <p className="mt-3 text-sm opacity-70">No agent runs in this period.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {days.map((d) => (
              <li key={d.day.toISOString()} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 tabular-nums opacity-70">{d.day.toISOString().slice(0, 10)}</span>
                <span className="h-4 flex-1">
                  <span className={`block h-4 rounded-sm ${agentColor.solid}`} style={{ width: `${(d.runs / maxDay) * 100}%` }} />
                </span>
                <span className="w-28 shrink-0 text-right tabular-nums">
                  {d.runs} {d.runs === 1 ? "run" : "runs"}
                  {d.failed ? <span className="text-red-600 dark:text-red-400">, {d.failed} failed</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="tools-heading" className="rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 id="tools-heading" className="font-medium">Tool usage</h2>
        {tools.length === 0 ? (
          <p className="mt-3 text-sm opacity-70">No tool calls in this period.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs dark:border-white/15">
                  <th className="py-2 pr-4 font-medium">Tool</th>
                  <th className="py-2 pr-4 font-medium">Calls</th>
                  <th className="w-1/3 py-2 pr-4 font-medium"><span className="sr-only">Share of calls</span></th>
                  <th className="py-2 pr-4 font-medium">Errors</th>
                  <th className="py-2 font-medium">Average time</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.tool} className="border-b border-black/5 last:border-0 dark:border-white/10">
                    <td className="py-2 pr-4"><code className={`rounded px-1.5 py-0.5 text-xs ${toolColor.soft}`}>{t.tool}</code></td>
                    <td className="py-2 pr-4 tabular-nums">{t.calls.toLocaleString()}</td>
                    <td className="py-2 pr-4"><span className={`block h-3 rounded-sm ${toolColor.solid}`} style={{ width: `${(t.calls / maxCalls) * 100}%` }} /></td>
                    <td className="py-2 pr-4 tabular-nums">{t.errors ? `${t.errors} (${pct(t.errors, t.calls)})` : "0"}</td>
                    <td className="py-2 tabular-nums">{t.avgMs != null ? formatDuration(t.avgMs) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
