import Link from "next/link";
import { formatDuration } from "@/lib/agent/trace-format";
import { STAGE_COLORS } from "@/lib/colors";
import { getPipelineMetrics } from "@/lib/pipeline/metrics";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
  { value: "all", label: "All time", ms: 0 },
] as const;

const LABELS: Record<string, string> = { convert: "Convert", analyze: "Analyze", enrich: "Enrich", rewrite: "Rewrite", index: "Index for chat" };
const colorFor = (stage: string) => (stage === "index" ? STAGE_COLORS.ready : STAGE_COLORS[stage as keyof typeof STAGE_COLORS] ?? STAGE_COLORS.import);

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {note ? <div className="mt-0.5 text-xs opacity-60">{note}</div> : null}
    </div>
  );
}

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requirePageUser();
  const { range: rangeParam } = await searchParams;
  const range = RANGES.find((r) => r.value === rangeParam) ?? RANGES[1];
  const m = await getPipelineMetrics(range.ms ? new Date(Date.now() - range.ms) : new Date(0));
  const top = [...m.stages].sort((a, b) => b.totalMs - a.totalMs)[0];
  const share = (ms: number) => (m.totalMs ? (ms / m.totalMs) * 100 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline metrics</h1>
          <p className="mt-1 text-sm opacity-70">How long each refine stage takes, and where the time goes. Counts begin when stage timing was added.</p>
        </div>
        <nav aria-label="Time range" className="flex gap-1 text-sm">
          {RANGES.map((r) => (
            <a
              key={r.value}
              href={`/metrics?range=${r.value}`}
              aria-current={r.value === range.value ? "page" : undefined}
              className={`rounded px-3 py-1.5 ${r.value === range.value ? "bg-black/10 font-medium dark:bg-white/15" : "hover:underline"}`}
            >
              {r.label}
            </a>
          ))}
        </nav>
      </div>

      {m.stages.length === 0 ? (
        <p className="rounded-lg border border-black/10 p-4 text-sm opacity-80 dark:border-white/15">No stage timings in this period. Refine an article and they appear here.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Articles processed" value={m.articles.toLocaleString()} />
            <Tile label="Average time per article" value={m.avgArticleMs != null ? formatDuration(m.avgArticleMs) : "–"} />
            <Tile label="Total time spent" value={formatDuration(m.totalMs)} />
            <Tile label="Biggest cost" value={top ? LABELS[top.stage] ?? top.stage : "–"} note={top ? `${Math.round(share(top.totalMs))}% of all time` : undefined} />
          </div>

          <section aria-labelledby="split-heading" className="rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 id="split-heading" className="font-medium">Where the time goes</h2>
            <div className="mt-3 flex h-6 overflow-hidden rounded" role="img" aria-label={m.stages.map((s) => `${LABELS[s.stage] ?? s.stage} ${Math.round(share(s.totalMs))}%`).join(", ")}>
              {m.stages.map((s) => (
                <span key={s.stage} className={colorFor(s.stage).solid} style={{ width: `${share(s.totalMs)}%` }} title={`${LABELS[s.stage] ?? s.stage}: ${Math.round(share(s.totalMs))}%`} />
              ))}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs dark:border-white/15">
                    <th className="py-2 pr-4 font-medium">Stage</th>
                    <th className="py-2 pr-4 font-medium">Share</th>
                    <th className="py-2 pr-4 font-medium">Runs</th>
                    <th className="py-2 pr-4 font-medium">Average</th>
                    <th className="py-2 pr-4 font-medium">Median</th>
                    <th className="py-2 pr-4 font-medium">Slowest 5%</th>
                    <th className="py-2 pr-4 font-medium">Longest</th>
                    <th className="py-2 font-medium">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {m.stages.map((s) => (
                    <tr key={s.stage} className="border-b border-black/5 last:border-0 dark:border-white/10">
                      <td className="py-2 pr-4">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${colorFor(s.stage).soft}`}>{LABELS[s.stage] ?? s.stage}</span>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{Math.round(share(s.totalMs))}%</td>
                      <td className="py-2 pr-4 tabular-nums">{s.runs}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatDuration(s.avgMs)}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatDuration(s.p50Ms)}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatDuration(s.p95Ms)}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatDuration(s.maxMs)}</td>
                      <td className="py-2 tabular-nums">{s.failed ? `${s.failed} (${Math.round((s.failed / s.runs) * 100)}%)` : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="slow-heading" className="rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 id="slow-heading" className="font-medium">Slowest articles</h2>
            <ul className="mt-3 divide-y divide-black/5 text-sm dark:divide-white/10">
              {m.slowest.map((a) => (
                <li key={a.articleId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <Link href={`/articles/${a.articleId}`} className="min-w-0 flex-1 truncate hover:underline">{a.title}</Link>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${colorFor(a.slowestStage).soft}`}>
                    {LABELS[a.slowestStage] ?? a.slowestStage} {formatDuration(a.slowestMs)}
                  </span>
                  <span className="w-24 text-right tabular-nums">{formatDuration(a.totalMs)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
