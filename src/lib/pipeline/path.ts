import { db } from "@/lib/db";

/** One side of a stage's example: a block of text, or a short list of label and value pairs. */
export interface PaneData {
  label: string;
  caption: string;
  kind: "code" | "list";
  text?: string;
  items?: { label: string; text: string }[];
}

/** Where an article can be: a ring, the core, one of the exits, or still on the source card. */
export type PlaceKey = "source" | "ingested" | "converted" | "analyzed" | "enriching" | "ready" | "no_gaps" | "failed";

const PLACES: Record<PlaceKey, string> = {
  source: "Not refined yet", ingested: "Queued", converted: "Converting", analyzed: "Analyzing", enriching: "Enriching",
  ready: "AI-ready", no_gaps: "No gaps found", failed: "Failed",
};

/**
 * Where one article is now. Keep in step with the CASE in getRefiningPath's counts.
 * @param itemStatus status of its latest job item, if any
 * @param stage its analysis stage, if it has an analysis
 * @param findings open findings on its analysis
 * @return the place it sits
 */
function placeOf(itemStatus: string | undefined, stage: string | undefined, findings: number): PlaceKey {
  if (itemStatus === "pending") return "ingested";
  if (itemStatus === "converting") return "converted";
  if (itemStatus === "analyzing") return "analyzed";
  if (itemStatus === "enriching" || itemStatus === "scoring") return "enriching";
  if (stage === "ready") return findings === 0 ? "no_gaps" : "ready";
  if (stage === "failed" || itemStatus === "failed") return "failed";
  return stage ? "ingested" : "source";
}

/** What happened to one article at one step. */
export type StepState = "done" | "active" | "queued" | "failed" | "skipped" | "waiting";

const STEP_ORDER = ["ingested", "converted", "analyzed", "enriching", "ready"] as const;
const FAILED_AT: Record<string, number> = { convert: 1, analyze: 2, enrich: 3, rewrite: 3 };

/**
 * Each step's state for one article, from where it is now.
 * @param place where the article sits
 * @param failedStage the stage its latest run failed in, if any
 * @return a state for every step on the path
 */
function stepsFor(place: PlaceKey, failedStage: string | null): Record<string, StepState> {
  const at = (n: (typeof STEP_ORDER)[number] | "source") => STEP_ORDER.indexOf(n as (typeof STEP_ORDER)[number]);
  const out: Record<string, StepState> = {};
  STEP_ORDER.forEach((id, i) => {
    let state: StepState = "waiting";
    if (place === "ready") state = "done";
    else if (place === "no_gaps") state = i <= 2 ? "done" : "skipped";
    else if (place === "failed") {
      const f = FAILED_AT[failedStage ?? ""] ?? 0;
      state = i < f ? "done" : i === f ? "failed" : "waiting";
    } else if (place !== "source") {
      const cur = at(place);
      state = i < cur ? "done" : i === cur ? (cur === 0 ? "queued" : "active") : "waiting";
    }
    out[id] = state;
  });
  return out;
}

export interface PathStage {
  id: "ingested" | "converted" | "analyzed" | "enriching" | "ready";
  kind: "ring" | "core";
  ringIndex: number | null;
  name: string;
  sub: string;
  desc: string;
  count: number;
  /** Rings only: the share (0 to 1) of refined articles that are in this stage now. It sets the ring's arc, so the ring matches the count. */
  progress: number;
  example: { in: PaneData; out: PaneData } | null;
  emptyMessage: string | null;
}

export interface RefiningPath {
  job: { id: string; processed: number; skipped: number } | null;
  stages: PathStage[];
  /** `share` is the part of refined articles that left this way, for the outer ring. */
  exits: { id: string; name: string; count: number; share: number }[];
  stats: { onPath: number; ready: number; working: number; leftEarly: number };
  sourceCount: number;
  /** Articles that have never been through a refine job. They wait on the source card. */
  notRefined: number;
  scoreTrack: { raw: number | null; converted: number | null; enriched: number | null };
  /** Every article that can be picked, each with the stage it is in now. Ones being worked on come first. */
  articles: { id: string; title: string; stage: PlaceKey; label: string }[];
  selectedArticleId: string;
  /** Where the selected article is now. Drives the marker on the rings and the list. */
  here: { stage: PlaceKey; label: string } | null;
  /** Set when an article is chosen: its state at each step. Null shows the counts instead. */
  steps: Record<string, StepState> | null;
  /** The chosen article, if any. */
  article: { id: string; title: string } | null;
  /** Size in bytes of the chosen article at each version. A version that does not exist yet is null. */
  sizes: { original: number | null; converted: number | null; rewritten: number | null } | null;
  /** True while the worker still has items in this job, so the page keeps refreshing. */
  live: boolean;
}

const PREVIEW = 900;
const preview = (s: string | null | undefined) => (s ? (s.length > PREVIEW ? `${s.slice(0, PREVIEW)}…` : s) : "");
const score = (n: number | null | undefined) => (n == null ? "–" : String(n));

/**
 * Everything the refining path needs: every article counted once, in the stage it is in now.
 * An article being worked on sits in its ring. A finished one is AI-ready, or "no gaps" when it has no open findings.
 * One that was never refined waits on the source card.
 * @param articleId the article to show examples for; defaults to the one analyzed most recently
 * @return the data for the page
 */
export async function getRefiningPath(articleId?: string): Promise<RefiningPath> {
  const [job, sourceCount, buckets, picks, scores] = await Promise.all([
    db.job.findFirst({ orderBy: { createdAt: "desc" } }),
    db.article.count(),
    db.$queryRaw<{ bucket: string; n: number }[]>`
      WITH latest AS (
        SELECT DISTINCT ON ("articleId") "articleId", status FROM "JobItem" ORDER BY "articleId", "updatedAt" DESC
      ), a AS (
        SELECT l.status AS item_status, an."pipelineStage" AS stage,
               (SELECT count(*) FROM "Finding" f WHERE f."analysisId" = an.id AND f.state <> 'cancelled') AS findings
        FROM "Article" ar
        LEFT JOIN latest l ON l."articleId" = ar.id
        LEFT JOIN "Analysis" an ON an."articleId" = ar.id
      )
      SELECT CASE
               WHEN item_status = 'pending' THEN 'pending'
               WHEN item_status = 'converting' THEN 'converting'
               WHEN item_status = 'analyzing' THEN 'analyzing'
               WHEN item_status IN ('enriching', 'scoring') THEN 'enriching'
               WHEN stage = 'ready' AND findings = 0 THEN 'noGaps'
               WHEN stage = 'ready' THEN 'completed'
               WHEN stage = 'failed' OR item_status = 'failed' THEN 'failed'
               WHEN stage IS NULL THEN 'notRefined'
               ELSE 'pending'
             END AS bucket,
             count(*)::int AS n
      FROM a GROUP BY 1`,
    db.article.findMany({
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true,
        title: true,
        analysis: { select: { pipelineStage: true, _count: { select: { findings: { where: { state: { not: "cancelled" } } } } } } },
        jobItems: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true } },
      },
    }),
    db.snapshot.groupBy({ by: ["type"], where: { score: { not: null } }, _avg: { score: true } }),
  ]);
  const c = { pending: 0, converting: 0, analyzing: 0, enriching: 0, completed: 0, failed: 0, noGaps: 0, notRefined: 0 };
  for (const b of buckets) c[b.bucket as keyof typeof c] = b.n;

  const busyPlaces = new Set<PlaceKey>(["ingested", "converted", "analyzed", "enriching"]);
  const articles = picks
    .map((p) => {
      const stage = placeOf(p.jobItems[0]?.status, p.analysis?.pipelineStage, p.analysis?._count.findings ?? 0);
      return { id: p.id, title: p.title, stage, label: PLACES[stage] };
    })
    .sort((x, y) => Number(busyPlaces.has(y.stage)) - Number(busyPlaces.has(x.stage)));
  const scoreTrack = { raw: null as number | null, converted: null as number | null, enriched: null as number | null };
  for (const x of scores) scoreTrack[x.type] = x._avg.score == null ? null : Math.round(x._avg.score);

  // No article is chosen until the user picks one, so the page shows counts first.
  const chosen = articleId ? articles.find((x) => x.id === articleId) : undefined;
  const selectedArticleId = chosen?.id ?? "";
  const item = selectedArticleId ? await db.jobItem.findFirst({ where: { articleId: selectedArticleId }, orderBy: { updatedAt: "desc" }, select: { status: true, message: true, failedStage: true } }) : null;
  const original = selectedArticleId ? await db.article.findUnique({ where: { id: selectedArticleId }, select: { body: true } }) : null;
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

  // Articles never refined have not entered the path. Each ring's arc is its share of the ones that have.
  const entered = c.pending + c.converting + c.analyzing + c.enriching + c.completed + c.noGaps + c.failed;
  const share = (n: number) => (entered ? Math.max(0, Math.min(1, n / entered)) : 0);

  const stages: PathStage[] = [
    {
      id: "ingested", kind: "ring", ringIndex: 1, name: "Ingest", sub: "queued for conversion", count: c.pending, progress: share(c.pending),
      desc: "The article is stored and waits its turn. An article that is already refined and unchanged since then is skipped, not refined again.",
      example: raw ? {
        in: { label: "Raw article", caption: "As stored", kind: "code", text: preview(raw.content) },
        out: { label: "Raw score", caption: "The baseline every later stage is compared against", kind: "list", items: [
          { label: "mechanical score", text: `${score(raw.score)} / 100` },
          { label: "this article", text: stateText },
          { label: "latest run", text: `${job?.articlesProcessed ?? 0} processed, ${job?.articlesSkipped ?? 0} skipped` },
        ] },
      } : null,
      emptyMessage: "This article has not been ingested yet.",
    },
    {
      id: "converted", kind: "ring", ringIndex: 2, name: "Convert", sub: "HTML → Markdown", count: c.converting, progress: share(c.converting),
      desc: "The one step with no model in it. The body becomes Markdown and both versions are scored, so conversion alone is measurable before any model runs.",
      example: raw && converted ? {
        in: { label: "Authored content", caption: "As stored", kind: "code", text: preview(raw.content) },
        out: { label: "Markdown", caption: `mechanical score ${score(converted.score)}`, kind: "code", text: preview(converted.content) },
      } : null,
      emptyMessage: raw && converted ? null : "This article has not been converted yet.",
    },
    {
      id: "analyzed", kind: "ring", ringIndex: 3, name: "Analyze", sub: "quality analysis · call 1", count: c.analyzing, progress: share(c.analyzing),
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
      id: "enriching", kind: "ring", ringIndex: 4, name: "Enrich", sub: "incident lookup · call 2", count: c.enriching, progress: share(c.enriching),
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
      id: "ready", kind: "core", ringIndex: null, name: "AI Ready", sub: "refined version published", count: c.completed, progress: share(c.completed),
      desc: "Every version is kept, not overwritten, so a rerun is a new comparison, not a replacement. The source article stays the record.",
      example: raw && enriched ? {
        in: { label: "What an agent saw before", caption: `mechanical score ${score(raw.score)}`, kind: "code", text: preview(raw.content) },
        out: { label: "What it reads now", caption: `mechanical score ${score(enriched.score)}`, kind: "code", text: preview(enriched.content) },
      } : null,
      emptyMessage: "This article has not finished the full path yet.",
    },
  ];

  const working = c.converting + c.analyzing + c.enriching;
  return {
    job: job ? { id: job.id, processed: job.articlesProcessed, skipped: job.articlesSkipped } : null,
    stages,
    exits: [
      { id: "no_gaps", name: "No gaps found", count: c.noGaps, share: share(c.noGaps) },
      { id: "failed", name: "Failed", count: c.failed, share: share(c.failed) },
    ],
    stats: { onPath: c.pending + working, ready: c.completed, working, leftEarly: c.noGaps + c.failed },
    sourceCount,
    notRefined: c.notRefined,
    scoreTrack: chosen ? { raw: raw?.score ?? null, converted: converted?.score ?? null, enriched: enriched?.score ?? null } : scoreTrack,
    articles,
    selectedArticleId,
    here: chosen ? { stage: chosen.stage, label: chosen.label } : null,
    steps: chosen ? stepsFor(chosen.stage, item?.failedStage ?? null) : null,
    article: chosen ? { id: chosen.id, title: chosen.title } : null,
    sizes: chosen
      ? {
          original: original ? Buffer.byteLength(original.body) : null,
          converted: converted ? Buffer.byteLength(converted.content) : null,
          rewritten: enriched ? Buffer.byteLength(enriched.content) : null,
        }
      : null,
    live: c.pending + working > 0,
  };
}
