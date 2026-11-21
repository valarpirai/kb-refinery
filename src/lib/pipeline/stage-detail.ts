import { db } from "@/lib/db";
import { formatBytes, formatDuration, label } from "@/lib/format";
import type { PipelineStep } from "./status";

export type StepKey = PipelineStep["key"];

export interface StageDetail {
  stage: StepKey;
  /** One sentence on what the stage does. */
  about: string;
  facts: { label: string; value: string }[];
  lists: { label: string; items: string[] }[];
  /** Latest runs of this stage, newest first. */
  runs: { status: string; duration: string; startedAt: string }[];
  /** The failure message when the latest run failed at this stage. */
  error: string | null;
}

const ABOUT: Record<StepKey, string> = {
  import: "The article was stored as it arrived. Nothing has changed it yet.",
  convert: "The body became Markdown, with no model involved. Both versions were scored.",
  analyze: "A model read the Markdown, scored its quality and listed what is wrong with it.",
  enrich: "Related incidents were matched, and a model asked what they reveal that the article is missing.",
  rewrite: "A model rewrote the article to fix the findings, then the rewrite was scored again.",
  ready: "The finished article was split into searchable chunks for chat.",
};

const STAGE_RUN_NAME: Partial<Record<StepKey, string>> = { convert: "convert", analyze: "analyze", enrich: "enrich", rewrite: "rewrite", ready: "index" };

const kb = (n: number | null | undefined, words?: number | null) => (n == null ? "–" : `${words != null ? `${words.toLocaleString("en-US")} words · ` : ""}${formatBytes(n)}`);
const delta = (from: number | null | undefined, to: number | null | undefined) => (from == null || to == null ? "–" : `${from} → ${to}${to === from ? " (no change)" : ` (${to > from ? "+" : ""}${to - from})`}`);
const count = (rows: string[]) => Object.entries(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {})).map(([k, n]) => `${label(k)} × ${n}`);

/**
 * Describe what happened to one article in one pipeline stage.
 * Facts come from what the stage stored: snapshots, findings, enrichment output and the stage's run history.
 * @param articleId the article
 * @param stage the pipeline step to describe
 * @return the details, or null when the article does not exist
 */
export async function getStageDetail(articleId: string, stage: StepKey): Promise<StageDetail | null> {
  const article = await db.article.findUnique({
    where: { id: articleId },
    include: { dataSource: { select: { name: true } }, importRun: { select: { label: true } }, analysis: { include: { findings: { where: { state: { not: "cancelled" } }, select: { type: true, severity: true, state: true } }, mentions: { include: { product: { select: { name: true } } } } } } },
  });
  if (!article) return null;
  const analysis = article.analysis;

  const latest = analysis ? await db.snapshot.findFirst({ where: { analysisId: analysis.id }, orderBy: { version: "desc" }, select: { version: true } }) : null;
  const snaps = analysis && latest ? await db.snapshot.findMany({ where: { analysisId: analysis.id, version: latest.version } }) : [];
  const snap = (t: string) => snaps.find((s) => s.type === t) ?? null;
  const raw = snap("raw");
  const converted = snap("converted");
  const enriched = snap("enriched");
  const bytes = (s: { content: string } | null) => (s ? Buffer.byteLength(s.content) : null);

  const facts: StageDetail["facts"] = [];
  const lists: StageDetail["lists"] = [];

  if (stage === "import") {
    facts.push(
      { label: "Source", value: article.dataSource?.name ?? article.importRun?.label ?? "Manual import" },
      { label: "Knowledge base", value: article.knowledgeBase ?? "None" },
      { label: "Format", value: article.format.toUpperCase() },
      { label: "Size", value: kb(Buffer.byteLength(article.body)) },
      { label: "Imported", value: article.createdAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" },
    );
    if (article.url) facts.push({ label: "URL", value: article.url });
  } else if (stage === "convert") {
    facts.push(
      { label: "From", value: `${article.format.toUpperCase()}, ${kb(bytes(raw) ?? Buffer.byteLength(article.body), raw?.wordCount)}` },
      { label: "To", value: `Markdown, ${kb(bytes(converted), converted?.wordCount)}` },
      { label: "Mechanical score", value: delta(raw?.score, converted?.score) },
      { label: "Model score", value: delta(raw?.llmScore, converted?.llmScore) },
      { label: "Images / links", value: `${converted?.imageCount ?? 0} images · ${converted?.linkCount ?? 0} links${converted?.brokenLinkCount ? ` · ${converted.brokenLinkCount} broken` : ""}` },
    );
  } else if (stage === "analyze" && analysis) {
    facts.push(
      { label: "Findings", value: String(analysis.findings.length) },
      { label: "Audience", value: label(analysis.targetAudience) || "unknown" },
      { label: "Model score of the Markdown", value: converted?.llmScore == null ? "–" : String(converted.llmScore) },
    );
    if (analysis.standardizedSummary) facts.push({ label: "Summary", value: analysis.standardizedSummary });
    if (analysis.findings.length) lists.push({ label: "Findings by type", items: count(analysis.findings.map((f) => f.type)) }, { label: "Findings by severity", items: count(analysis.findings.map((f) => f.severity ?? "medium")) });
    const terms = (analysis.searchTerms as string[]) ?? [];
    if (terms.length) lists.push({ label: "Search terms", items: terms });
    if (analysis.mentions.length) lists.push({ label: "Products mentioned (added as tags)", items: analysis.mentions.map((m) => `${m.product.name} × ${m.mentionCount}`) });
  } else if (stage === "enrich" && analysis) {
    const k = analysis.enrichmentKnowledge as { incident_analysis?: { relevant?: boolean }[]; contradictions?: unknown[]; recommendations?: string[]; summary?: string; confidence?: string } | null;
    if (!k) facts.push({ label: "Result", value: "Skipped. The article had no content gap that incidents could fill." });
    else {
      facts.push(
        { label: "Incidents looked at", value: String(k.incident_analysis?.length ?? 0) },
        { label: "Relevant", value: String(k.incident_analysis?.filter((i) => i.relevant).length ?? 0) },
        { label: "Contradictions found", value: String(k.contradictions?.length ?? 0) },
        { label: "Confidence", value: label(k.confidence) || "unknown" },
      );
      if (k.summary) facts.push({ label: "Summary", value: k.summary });
      if (k.recommendations?.length) lists.push({ label: "Recommendations", items: k.recommendations });
    }
  } else if (stage === "rewrite") {
    if (!enriched) facts.push({ label: "Result", value: "No rewrite was made for this version." });
    else {
      facts.push(
        { label: "Size", value: `${kb(bytes(converted), converted?.wordCount)} → ${kb(bytes(enriched), enriched.wordCount)}` },
        { label: "Mechanical score", value: delta(converted?.score, enriched.score) },
        { label: "Model score", value: delta(converted?.llmScore, enriched.llmScore) },
      );
      if (enriched.processingMessage) facts.push({ label: "What changed", value: enriched.processingMessage });
    }
    if (analysis) lists.push({ label: "Finding states", items: count(analysis.findings.map((f) => f.state)) });
  } else if (stage === "ready") {
    const chunks = await db.chunk.groupBy({ by: ["variant"], where: { articleId }, _count: true });
    const final = enriched ?? converted;
    facts.push(
      { label: "Final size", value: kb(bytes(final), final?.wordCount) },
      { label: "Final scores", value: `${final?.score ?? "–"} mechanical · ${final?.llmScore ?? "–"} model` },
      { label: "Search chunks", value: chunks.length ? chunks.map((c) => `${c._count} ${c.variant}`).join(" · ") : "None yet" },
    );
  }

  const runName = STAGE_RUN_NAME[stage];
  const runs = runName ? await db.stageRun.findMany({ where: { articleId, stage: runName }, orderBy: { startedAt: "desc" }, take: 5, select: { status: true, durationMs: true, startedAt: true } }) : [];
  const item = await db.jobItem.findFirst({ where: { articleId }, orderBy: { updatedAt: "desc" }, select: { status: true, failedStage: true, message: true } });
  const failedHere = item?.status === "failed" && (item.failedStage ?? "convert") === stage;

  return {
    stage,
    about: ABOUT[stage],
    facts,
    lists,
    runs: runs.map((r) => ({ status: r.status === "ok" ? "Done" : "Failed", duration: formatDuration(r.durationMs), startedAt: r.startedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" })),
    error: failedHere ? item?.message || "No error message was recorded." : null,
  };
}
