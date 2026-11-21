import { LiveNumber } from "@/components/live-number";
import { PipelineHero } from "@/components/pipeline-hero";
import { getRefiningPath } from "@/lib/pipeline/path";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Refining path · KB Refinery" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ article?: string }> }) {
  await requirePageUser();
  const { article } = await searchParams;
  const data = await getRefiningPath(article);
  const tiles = [
    { label: "On the refining path", value: data.stats.onPath },
    { label: "AI-ready", value: data.stats.ready },
    { label: "Being worked on now", value: data.stats.working },
    { label: "Left the path early", value: data.stats.leftEarly },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Refining path</h1>
        <p className="mt-2 max-w-3xl text-sm opacity-70">
          {data.sourceCount.toLocaleString()} articles refined from authored content into something an agent can read. Pick any state to see what actually happens there.
          {data.job ? "" : " No refine job has run yet."}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label}>
            <dt className="text-base opacity-80">{t.label}</dt>
            <dd className="mt-1 text-5xl font-medium tabular-nums tracking-tight">
              <LiveNumber value={t.value} />
            </dd>
          </div>
        ))}
      </dl>

      <PipelineHero data={data} />
    </div>
  );
}
