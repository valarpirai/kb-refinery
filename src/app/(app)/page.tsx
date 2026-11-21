import Link from "next/link";
import { LiveNumber } from "@/components/live-number";
import { PipelineHero } from "@/components/pipeline-hero";
import { RefinePicker } from "@/components/refine-picker";
import { StatusPill } from "@/components/status-pill";
import { db } from "@/lib/db";
import { getRefiningPath } from "@/lib/pipeline/path";

export const dynamic = "force-dynamic";

function Tile({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <p className="text-xs uppercase tracking-wide opacity-70">{title}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs opacity-70">{hint}</p>}
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ article?: string }> }) {
  const { article } = await searchParams;
  const [path, articles, ready, openFindings, averages, recent, products] = await Promise.all([
    getRefiningPath(article),
    db.article.count(),
    db.analysis.count({ where: { pipelineStage: "ready" } }),
    db.finding.count({ where: { state: "new", type: { not: "duplicate" } } }),
    db.snapshot.groupBy({ by: ["type"], _avg: { score: true, llmScore: true } }),
    db.analysis.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: {
        article: { select: { title: true, knowledgeBase: true } },
        snapshots: { orderBy: { version: "desc" }, take: 3, select: { type: true, score: true, llmScore: true } },
        _count: { select: { findings: { where: { state: "new" } } } },
      },
    }),
    db.product.findMany({ where: { articleCount: { gt: 0 } }, orderBy: { articleCount: "desc" }, take: 8 }),
  ]);

  const avg = (type: string) => averages.find((a) => a.type === type)?._avg.score;
  const fmt = (n: number | null | undefined) => (n == null ? "–" : Math.round(n));
  const maxCount = Math.max(1, ...products.map((p) => p.articleCount));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">KB Refinery</h1>
          <p className="mt-1 max-w-3xl text-sm opacity-70">
            {path.sourceCount.toLocaleString()} articles refined from authored content into something an agent can read. Pick any state to see what actually happens there.
          </p>
        </div>
        <RefinePicker />
      </div>

      <dl aria-label="Refining path" className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
        {[
          { label: "On the refining path", value: path.stats.onPath },
          { label: "AI-ready", value: path.stats.ready },
          { label: "Being worked on now", value: path.stats.working },
          { label: "Left the path early", value: path.stats.leftEarly },
        ].map((t) => (
          <div key={t.label}>
            <dt className="text-base opacity-80">{t.label}</dt>
            <dd className="mt-1 text-5xl font-medium tabular-nums tracking-tight">
              <LiveNumber value={t.value} />
            </dd>
          </div>
        ))}
      </dl>

      <PipelineHero data={path} />

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile title="Articles" value={articles} hint={`${ready} refined`} />
        <Tile title="Open findings" value={openFindings} />
        <Tile title="Avg score, raw" value={fmt(avg("raw"))} hint="Mechanical, out of 100" />
        <Tile title="Avg score, rewritten" value={fmt(avg("enriched"))} hint={`Converted: ${fmt(avg("converted"))}`} />
      </section>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-3 text-lg font-medium">Recent articles</h2>
        {recent.length === 0 ? (
          <p className="text-sm opacity-70">Nothing analyzed yet. Import articles, then choose Refine articles.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/10 dark:border-white/15">
                <tr>
                  <th className="py-2 pr-4">Article</th>
                  <th className="pr-4">Stage</th>
                  <th className="pr-4">Raw</th>
                  <th className="pr-4">Rewritten</th>
                  <th>Open findings</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => {
                  const score = (t: string) => a.snapshots.find((s) => s.type === t)?.score;
                  return (
                    <tr key={a.id} className="border-b border-black/5 dark:border-white/10">
                      <td className="py-2 pr-4">
                        <Link href={`/analysis/${a.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">{a.article.title}</Link>
                        <span className="block text-xs opacity-70">{a.article.knowledgeBase}</span>
                      </td>
                      <td className="pr-4"><StatusPill status={a.pipelineStage} /></td>
                      <td className="pr-4">{fmt(score("raw"))}</td>
                      <td className="pr-4">{fmt(score("enriched"))}</td>
                      <td>{a._count.findings}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="products">
        <h2 id="products" className="mb-3 text-lg font-medium">Products mentioned</h2>
        {products.length === 0 ? (
          <p className="text-sm opacity-70">No products found yet.</p>
        ) : (
          <ul className="space-y-2">
            {products.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate">{p.name}</span>
                <span className="h-3 rounded bg-blue-600" style={{ width: `${(p.articleCount / maxCount) * 60}%`, minWidth: "0.5rem" }} aria-hidden="true" />
                <span>{p.articleCount} article{p.articleCount === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
