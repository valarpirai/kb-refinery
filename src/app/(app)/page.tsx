import { LiveNumber } from "@/components/live-number";
import { PipelineHero } from "@/components/pipeline-hero";
import { RefinePicker } from "@/components/refine-picker";
import { db } from "@/lib/db";
import { getRefiningPath } from "@/lib/pipeline/path";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ article?: string }> }) {
  const { article } = await searchParams;
  const [path, openFindings, products] = await Promise.all([
    getRefiningPath(article),
    db.finding.count({ where: { state: "new", type: { not: "duplicate" } } }),
    db.product.findMany({ where: { articleCount: { gt: 0 } }, orderBy: { articleCount: "desc" }, take: 8 }),
  ]);
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

      <dl aria-label="Summary" className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-5">
        {[
          { label: "On the refining path", value: path.stats.onPath },
          { label: "AI-ready", value: path.stats.ready },
          { label: "Being worked on now", value: path.stats.working },
          { label: "Left the path early", value: path.stats.leftEarly },
          { label: "Open findings", value: openFindings },
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
