import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentViewer, type Version } from "@/components/content-viewer";
import { ScoreChart } from "@/components/score-chart";
import { StatusPill } from "@/components/status-pill";
import { db } from "@/lib/db";
import { label, severityClass } from "@/lib/format";

export const dynamic = "force-dynamic";

const ORDER = ["raw", "converted", "enriched"] as const;
const STAGE_NAME = { raw: "Original", converted: "Converted", enriched: "Rewritten" } as const;

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await db.analysis.findUnique({
    where: { id },
    include: {
      article: true,
      findings: {
        where: { state: { not: "cancelled" } },
        orderBy: { createdAt: "asc" },
        include: {
          relatedAnalysis: { select: { id: true, article: { select: { title: true } } } },
          evidence: { include: { incident: { select: { number: true, shortDescription: true } } } },
        },
      },
      mentions: { include: { product: true }, orderBy: { mentionCount: "desc" } },
    },
  });
  if (!analysis) notFound();

  const latest = await db.snapshot.findFirst({ where: { analysisId: id }, orderBy: { version: "desc" }, select: { version: true } });
  const snapshots = latest ? await db.snapshot.findMany({ where: { analysisId: id, version: latest.version } }) : [];
  const byType = (t: string) => snapshots.find((s) => s.type === t);

  const rows = ORDER.filter((t) => byType(t)).map((t) => ({ stage: STAGE_NAME[t], mechanical: byType(t)!.score, model: byType(t)!.llmScore }));
  const versions: Version[] = ORDER.filter((t) => byType(t)).map((t) => ({
    type: t,
    content: byType(t)!.content,
    format: t === "raw" ? analysis.article.format : "md",
  }));
  const groups = (["high", "medium", "low"] as const).map((sev) => ({ sev, items: analysis.findings.filter((f) => (f.severity ?? "medium") === sev) }));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-blue-700 hover:underline dark:text-blue-300">← Home</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{analysis.article.title}</h1>
          <StatusPill status={analysis.pipelineStage} />
        </div>
        <p className="mt-1 text-sm opacity-70">
          {analysis.article.knowledgeBase ?? "No knowledge base"} · Audience: {label(analysis.targetAudience) || "unknown"}
          {analysis.enrichmentConfidence && ` · Enrichment confidence: ${analysis.enrichmentConfidence}`}
        </p>
        {analysis.standardizedSummary && <p className="mt-3 text-sm">{analysis.standardizedSummary}</p>}
      </div>

      <section aria-labelledby="scores">
        <h2 id="scores" className="mb-3 text-lg font-medium">Scores</h2>
        {rows.length === 0 ? <p className="text-sm opacity-70">Not scored yet.</p> : <ScoreChart rows={rows} />}
      </section>

      <section aria-labelledby="findings">
        <h2 id="findings" className="mb-3 text-lg font-medium">Findings ({analysis.findings.length})</h2>
        {analysis.findings.length === 0 ? (
          <p className="text-sm opacity-70">No findings.</p>
        ) : (
          groups.filter((g) => g.items.length).map((g) => (
            <div key={g.sev} className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">{label(g.sev)} severity</h3>
              <ul className="space-y-2">
                {g.items.map((f) => (
                  <li key={f.id} className="rounded border border-black/10 p-3 text-sm dark:border-white/15">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityClass(f.severity)}`}>{label(f.type)}</span>
                      <span className="text-xs opacity-70">{label(f.state)}</span>
                    </div>
                    {f.detail && <p className="mt-2">{f.detail}</p>}
                    {f.brokenUrl && <p className="mt-1 break-all font-mono text-xs">{f.brokenUrl}</p>}
                    {f.relatedAnalysis && (
                      <p className="mt-1 text-xs">
                        Overlaps with <Link href={`/analysis/${f.relatedAnalysis.id}`} className="text-blue-700 underline dark:text-blue-300">{f.relatedAnalysis.article.title}</Link>
                      </p>
                    )}
                    {f.evidence.length > 0 && (
                      <ul className="mt-2 space-y-1 border-l-2 border-black/10 pl-3 text-xs dark:border-white/20">
                        {f.evidence.map((e) => (
                          <li key={e.id}>
                            <strong>{e.incident.number}</strong> {e.incident.shortDescription}
                            {e.newInformation && <span className="block opacity-80">{e.newInformation}</span>}
                            {e.contradictsArticle && <span className="block text-red-700 dark:text-red-300">Contradicts the article</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="products">
        <h2 id="products" className="mb-3 text-lg font-medium">Products mentioned</h2>
        {analysis.mentions.length === 0 ? (
          <p className="text-sm opacity-70">None found.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {analysis.mentions.map((m) => (
              <li key={m.id} className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">{m.product.name} × {m.mentionCount}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="content">
        <h2 id="content" className="mb-3 text-lg font-medium">Content</h2>
        {versions.length === 0 ? <p className="text-sm opacity-70">No content yet.</p> : <ContentViewer versions={versions} />}
      </section>
    </div>
  );
}
