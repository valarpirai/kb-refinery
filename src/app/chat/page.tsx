import Link from "next/link";
import { ChatCompare, type ComparisonData } from "@/components/chat-compare";
import { ReindexButton } from "@/components/reindex-button";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const [selected, history, chunkCounts, indexedArticles, analyzed] = await Promise.all([
    c ? db.comparison.findUnique({ where: { id: c }, include: { arms: true } }) : null,
    db.comparison.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { arms: { select: { variant: true, judge: true } } } }),
    db.chunk.groupBy({ by: ["variant"], _count: true }),
    db.chunk.findMany({ distinct: ["articleId"], select: { articleId: true } }),
    db.analysis.count({ where: { pipelineStage: "ready" } }),
  ]);

  const all = await db.comparison.findMany({ select: { verdict: true, arms: { select: { variant: true, judge: true } } } });
  const tally = { original: 0, refined: 0, tie: 0, neither: 0 };
  all.forEach((x) => x.verdict && tally[x.verdict]++);
  const rated = Object.values(tally).reduce((a, b) => a + b, 0);
  const judgeAvg = (variant: "original" | "refined") => {
    const scores = all.flatMap((x) => x.arms.filter((a) => a.variant === variant && a.judge).map((a) => (a.judge as { score: number }).score));
    return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "–";
  };
  const chunks = (v: string) => chunkCounts.find((x) => x.variant === v)?._count ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="mt-1 text-sm opacity-70">Ask one question. Get an answer from the original docs and one from the refined docs. Compare them.</p>
      </div>

      <section aria-label="Index status" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15">
        <span>{indexedArticles.length} of {analyzed} refined articles indexed</span>
        <span className="opacity-70">{chunks("original")} original chunks · {chunks("refined")} refined chunks</span>
        <ReindexButton />
      </section>

      <ChatCompare key={selected?.id ?? "new"} initial={selected ? (JSON.parse(JSON.stringify(selected)) as ComparisonData) : null} />

      <section aria-labelledby="results">
        <h2 id="results" className="mb-3 text-lg font-medium">Results so far</h2>
        {rated === 0 ? (
          <p className="text-sm opacity-70">No verdicts yet. Choose a winner after each comparison and the totals show here.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            {([["Refined better", tally.refined], ["Original better", tally.original], ["About the same", tally.tie], ["Neither good", tally.neither]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-black/10 p-3 dark:border-white/15"><dt className="text-xs opacity-70">{k}</dt><dd className="text-xl font-semibold">{v}<span className="ml-1 text-xs font-normal opacity-70">of {rated}</span></dd></div>
            ))}
            <div className="rounded-lg border border-black/10 p-3 dark:border-white/15"><dt className="text-xs opacity-70">Auto-judge average</dt><dd>Original {judgeAvg("original")} · Refined {judgeAvg("refined")}</dd></div>
          </dl>
        )}
      </section>

      <section aria-labelledby="history">
        <h2 id="history" className="mb-3 text-lg font-medium">Past questions</h2>
        {history.length === 0 ? (
          <p className="text-sm opacity-70">None yet.</p>
        ) : (
          <ul className="divide-y divide-black/10 text-sm dark:divide-white/15">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <Link href={`/chat?c=${h.id}`} className="text-blue-700 hover:underline dark:text-blue-300">{h.query}</Link>
                <span className="text-xs opacity-70">{h.verdict ? `Verdict: ${h.verdict}` : "No verdict"} · {h.createdAt.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
