import { db } from "@/lib/db";

/** One side of a stage's example: a block of text, or a short list of label and value pairs. */
export interface PaneData {
  label: string;
  caption: string;
  kind: "code" | "list";
  text?: string;
  items?: { label: string; text: string }[];
}

export interface PathStage {
  id: "ingested" | "converted" | "analyzed" | "enriching" | "ready";
  kind: "ring" | "core";
  ringIndex: number | null;
  name: string;
  sub: string;
  desc: string;
  count: number;
  example: { in: PaneData; out: PaneData } | null;
  emptyMessage: string | null;
}

export interface RefiningPath {
  job: { id: string; processed: number; skipped: number } | null;
  stages: PathStage[];
  exits: { id: string; name: string; count: number }[];
  stats: { onPath: number; ready: number; working: number; leftEarly: number };
  sourceCount: number;
  scoreTrack: { raw: number | null; converted: number | null; enriched: number | null };
  articles: { id: string; title: string }[];
  selectedArticleId: string;
  /** True while the worker still has items in this job, so the page keeps refreshing. */
  live: boolean;
}

const PREVIEW = 900;
const preview = (s: string | null | undefined) => (s ? (s.length > PREVIEW ? `${s.slice(0, PREVIEW)}…` : s) : "");
const score = (n: number | null | undefined) => (n == null ? "–" : String(n));

/**
 * Everything the refining-path page needs for the latest job: counts per stage, the exits,
 * the headline numbers, the score progression and one article's real content at each stage.
 * Counts are for the latest job, so the page reads as "this run".
 * @param articleId the article to show examples for; defaults to the one touched most recently
 * @return the data for the page
 */
export async function getRefiningPath(articleId?: string): Promise<RefiningPath> {
  const [job, sourceCount] = await Promise.all([db.job.findFirst({ orderBy: { createdAt: "desc" } }), db.article.count()]);
  const c = { pending: 0, converting: 0, analyzing: 0, enriching: 0, scoring: 0, completed: 0, failed: 0, skipped: 0, noGaps: 0 };
  let articles: { id: string; title: string }[] = [];
  let latestItem: { articleId: string; status: string; message: string | null } | null = null;
  const scoreTrack = { raw: null as number | null, converted: null as number | null, enriched: null as number | null };

  if (job) {
    const [items, scores] = await Promise.all([
      db.jobItem.findMany({
        where: { jobId: job.id },
        orderBy: { updatedAt: "desc" },
        select: { articleId: true, status: true, message: true, article: { select: { title: true } }, analysis: { select: { _count: { select: { findings: { where: { state: { not: "cancelled" } } } } } } } },
      }),
      db.snapshot.groupBy({ by: ["type"], where: { lastJobId: job.id, score: { not: null } }, _avg: { score: true } }),
    ]);
    for (const i of items) {
      if (i.status === "completed" && (i.analysis?._count.findings ?? 0) === 0) c.noGaps++;
      else c[i.status]++;
    }
    articles = items.slice(0, 200).map((i) => ({ id: i.articleId, title: i.article.title }));
    latestItem = items[0] ?? null;
    for (const s of scores) scoreTrack[s.type] = s._avg.score == null ? null : Math.round(s._avg.score);
  }

  const selectedArticleId = articles.find((a) => a.id === articleId)?.id ?? articles[0]?.id ?? "";
  const item = job && selectedArticleId ? await db.jobItem.findFirst({ where: { jobId: job.id, articleId: selectedArticleId }, select: { status: true, message: true } }) : null;
  const analysis = selectedArticleId
    ? await db.analysis.findUnique({
        where: { articleId: selectedArticleId },
        include: { findings: { where: { state: { not: "cancelled" } }, orderBy: { createdAt: "asc" } }, snapshots: { orderBy: { version: "desc" } } },
      })
    : null;
  const version = analysis?.snapshots[0]?.version;
  const snap = (type: string) => analysis?.snapshots.find((s) => s.version === version && s.type === type) ?? null;
  const raw = snap("raw");
  const converted = snap("converted");
  const enriched = snap("enriched");
  const knowledge = analysis?.enrichmentKnowledge as { incident_analysis?: { relevant?: boolean }[]; summary?: string; confidence?: string; recommendations?: string[] } | null;
  const stateText = item?.status === "skipped" ? "Skipped, unchanged since the last run" : item?.status === "pending" ? "Queued for conversion" : `Now: ${item?.status ?? "not in this run"}`;

  const stages: PathStage[] = [
    {
      id: "ingested", kind: "ring", ringIndex: 1, name: "Ingest", sub: "queued for conversion", count: c.pending,
      desc: "The article is stored and waits its turn. An article that is already refined and unchanged since then is skipped, not refined again.",
      example: raw ? {
        in: { label: "Raw article", caption: "As stored", kind: "code", text: preview(raw.content) },
        out: { label: "Raw score", caption: "The baseline every later stage is compared against", kind: "list", items: [
          { label: "mechanical score", text: `${score(raw.score)} / 100` },
          { label: "this article", text: stateText },
          { label: "this run", text: `${job?.articlesProcessed ?? 0} processed, ${job?.articlesSkipped ?? 0} skipped` },
        ] },
      } : null,
      emptyMessage: raw ? null : selectedArticleId ? "This article has not been ingested yet." : "No job has run yet. Refine some articles to see real activity here.",
    },
    {
      id: "converted", kind: "ring", ringIndex: 2, name: "Convert", sub: "HTML → Markdown", count: c.converting,
      desc: "The one step with no model in it. The body becomes Markdown and both versions are scored, so conversion alone is measurable before any model runs.",
      example: raw && converted ? {
        in: { label: "Authored content", caption: "As stored", kind: "code", text: preview(raw.content) },
        out: { label: "Markdown", caption: `mechanical score ${score(converted.score)}`, kind: "code", text: preview(converted.content) },
      } : null,
      emptyMessage: raw && converted ? null : "This article has not been converted yet.",
    },
    {
      id: "analyzed", kind: "ring", ringIndex: 3, name: "Analyze", sub: "quality analysis · call 1", count: c.analyzing,
      desc: "One model call reads the Markdown and lists what is wrong with it, who it is for and which search terms fit. A duplicate check against other articles runs here too.",
      example: analysis && converted ? {
        in: { label: "Findings", caption: `${analysis.findings.length} open`, kind: "list", items: analysis.findings.length
          ? analysis.findings.slice(0, 6).map((f) => ({ label: f.severity ?? "unrated", text: f.type.replaceAll("_", " ") }))
          : [{ label: "none", text: "no findings" }] },
        out: { label: "Classification", caption: "What the model decided", kind: "list", items: [
          { label: "audience", text: analysis.targetAudience?.replaceAll("_", " ") ?? "unknown" },
          { label: "search terms", text: (analysis.searchTerms as string[]).slice(0, 5).join(", ") || "none" },
          { label: "model score", text: `${score(converted.llmScore)} / 100` },
        ] },
      } : null,
      emptyMessage: "This article has not been analyzed yet.",
    },
    {
      id: "enriching", kind: "ring", ringIndex: 4, name: "Enrich", sub: "incident lookup · call 2", count: c.enriching + c.scoring,
      desc: "Only articles with a real content gap get here. Related incidents are matched first, then one call asks which of them reveal what the article is missing. The rewrite and its re-score follow.",
      example: knowledge ? {
        in: { label: "Related incidents", caption: "Matched before the model call", kind: "list", items: [
          { label: "looked at", text: String(knowledge.incident_analysis?.length ?? 0) },
          { label: "relevant", text: String(knowledge.incident_analysis?.filter((x) => x.relevant).length ?? 0) },
        ] },
        out: { label: "What it learned", caption: `confidence: ${knowledge.confidence ?? "unknown"}`, kind: "list", items: [
          { label: "summary", text: knowledge.summary || "none" },
          ...(knowledge.recommendations ?? []).slice(0, 3).map((r) => ({ label: "advice", text: r })),
        ] },
      } : null,
      emptyMessage: "This article has not reached enrichment, or it had no content gap.",
    },
    {
      id: "ready", kind: "core", ringIndex: null, name: "AI Ready", sub: "refined version published", count: c.completed,
      desc: "Every version is kept, not overwritten, so a rerun is a new comparison, not a replacement. The source article stays the record.",
      example: raw && enriched ? {
        in: { label: "What an agent saw before", caption: `mechanical score ${score(raw.score)}`, kind: "code", text: preview(raw.content) },
        out: { label: "What it reads now", caption: `mechanical score ${score(enriched.score)}`, kind: "code", text: preview(enriched.content) },
      } : null,
      emptyMessage: "This article has not finished the full path yet.",
    },
  ];

  const working = c.converting + c.analyzing + c.enriching + c.scoring;
  return {
    job: job ? { id: job.id, processed: job.articlesProcessed, skipped: job.articlesSkipped } : null,
    stages,
    exits: [
      { id: "no_gaps", name: "No gaps found", count: c.noGaps },
      { id: "skipped", name: "Skipped", count: c.skipped },
      { id: "failed", name: "Failed", count: c.failed },
    ],
    stats: { onPath: c.pending + working, ready: c.completed, working, leftEarly: c.noGaps + c.skipped + c.failed },
    sourceCount,
    scoreTrack,
    articles,
    selectedArticleId,
    live: c.pending + working > 0 && latestItem !== null,
  };
}
