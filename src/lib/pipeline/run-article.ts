import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { indexArticle } from "@/lib/chat/indexer";
import { toMarkdown } from "./convert";
import { formatFindings, formatIncidents, jsonOrNone } from "./format";
import { findCandidateIncidents } from "./incidents";
import { chatJson } from "./ollama";
import { renderPrompt } from "./prompts";
import { analysisSchema, CONTENT_GAP_TYPES, duplicateSchema, enrichmentSchema, scoreOnlySchema, synthesisSchema, type AnalysisResult } from "./schemas";
import { scoreContent } from "./scorer";
import { ClaimLostError, HEARTBEAT_MS, WORKER_ID } from "./worker-id";

type ItemStatus = "pending" | "converting" | "analyzing" | "enriching" | "scoring" | "completed" | "failed" | "skipped";

/**
 * Update an item's status, but only while this worker still holds it.
 * Also counts as a heartbeat. Throws ClaimLostError when the item was reassigned.
 */
async function setStatus(id: string, status: ItemStatus, message?: string) {
  const result = await db.jobItem.updateMany({
    where: { id, claimedBy: WORKER_ID },
    data: { status, message: message ?? null, heartbeatAt: new Date(), ...(status === "failed" ? {} : { failedStage: null }) },
  });
  if (result.count === 0) throw new ClaimLostError();
}

/** Mechanical score and counters for one body of content. */
function mechanical(content: string) {
  const r = scoreContent(content);
  return {
    score: r.ok && r.score !== null ? Math.round(r.score) : null,
    wordCount: r.stats?.wordCount ?? null,
    imageCount: r.stats?.imageCount ?? null,
    linkCount: r.stats?.linkCount ?? null,
    tokenCount: r.stats ? Math.round(r.stats.words * 1.3) : null,
  };
}

/** Variables shared by the Call 1 prompt for any content stage. */
function analysisVars(article: { title: string; knowledgeBase: string | null; updatedAt: Date }, content: string) {
  return {
    title: article.title,
    articletype: "Knowledge article",
    kbname: article.knowledgeBase ?? "General",
    lastupdated: article.updatedAt.toISOString().slice(0, 10),
    currentdate: new Date().toISOString().slice(0, 10),
    content,
  };
}

/** Run Call 1 against some content and keep only its quality score. */
async function llmScore(article: Parameters<typeof analysisVars>[0], content: string): Promise<number | null> {
  try {
    const prompt = await renderPrompt("kb_article_analysis", analysisVars(article, content));
    return Math.round((await chatJson(prompt, scoreOnlySchema)).data.quality_score);
  } catch {
    return null;
  }
}

/** Find a product by name or alias, or create it. */
async function productFor(name: string) {
  const clean = name.trim();
  const found =
    (await db.product.findFirst({ where: { name: { equals: clean, mode: "insensitive" } } })) ??
    (await db.product.findFirst({ where: { aliases: { contains: clean, mode: "insensitive" } } }));
  return found ?? db.product.create({ data: { name: clean } });
}

/** Replace an article's product mentions and refresh the affected counters. */
async function saveMentions(analysisId: string, names: string[]) {
  const before = await db.mention.findMany({ where: { analysisId }, select: { productId: true } });
  await db.mention.deleteMany({ where: { analysisId } });
  const touched = new Set(before.map((m) => m.productId));
  const counts = new Map<string, number>();
  for (const n of names.filter((n) => n.trim())) {
    const p = await productFor(n);
    counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  }
  for (const [productId, mentionCount] of counts) {
    await db.mention.create({ data: { analysisId, productId, mentionCount } });
    touched.add(productId);
  }
  for (const productId of touched) {
    await db.product.update({ where: { id: productId }, data: { articleCount: await db.mention.count({ where: { productId } }) } });
  }
}

/** Compare a new analysis with earlier ones in the same job and flag confirmed duplicates. */
async function findDuplicates(jobId: string, analysisId: string, summary: string, terms: string[]) {
  const mine = new Set(terms.map((t) => t.toLowerCase()));
  const others = await db.analysis.findMany({
    where: { id: { not: analysisId }, jobItems: { some: { jobId } }, standardizedSummary: { not: null } },
  });
  const candidates = others
    .map((o) => {
      const theirs = (o.searchTerms as string[]).map((t) => t.toLowerCase());
      return { o, shared: theirs.filter((t) => mine.has(t)).length };
    })
    .filter((c) => c.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 3);

  let found = 0;
  for (const { o } of candidates) {
    const prompt = await renderPrompt("duplicate_confirmation", {
      summary_a: summary, terms_a: terms.join(", "),
      summary_b: o.standardizedSummary ?? "", terms_b: (o.searchTerms as string[]).join(", "),
    });
    const { data } = await chatJson(prompt, duplicateSchema);
    if (!data.same_topic) continue;
    const primary = data.more_complete_article === "a" ? analysisId : o.id;
    for (const [from, to] of [[analysisId, o.id], [o.id, analysisId]] as const) {
      // A re-run must not add the same pair twice.
      const exists = await db.finding.count({ where: { analysisId: from, relatedAnalysisId: to, type: "duplicate", state: { not: "cancelled" } } });
      if (exists > 0) continue;
      await db.finding.create({
        data: { analysisId: from, type: "duplicate", severity: "medium", relatedAnalysisId: to,
          recommendedPrimaryId: primary, detail: data.reasoning, lastJobId: jobId },
      });
    }
    found++;
  }
  return found;
}

type Article = NonNullable<Awaited<ReturnType<typeof db.article.findUnique>>>;

/** Stage 1: score raw content, convert to Markdown, score the result. */
async function convertStage(article: Article, analysisId: string, jobId: string, version: number) {
  const converted = toMarkdown(article.body, article.format);
  const now = new Date();
  await db.snapshot.create({
    data: { analysisId, type: "raw", version, content: article.body, ...mechanical(article.body), processedAt: now, lastJobId: jobId },
  });
  await db.snapshot.create({
    data: { analysisId, type: "converted", version, content: converted, ...mechanical(converted), processedAt: now, lastJobId: jobId },
  });
  return converted;
}

/** Stage 2: Call 1 on converted content, plus score-only calls on raw content. Saves findings, terms, products. */
async function analyzeStage(article: Article, analysisId: string, jobId: string, version: number, converted: string) {
  const prompt = await renderPrompt("kb_article_analysis", analysisVars(article, converted));
  const { data } = await chatJson(prompt, analysisSchema);
  const rawLlm = await llmScore(article, article.body);

  await db.snapshot.update({
    where: { analysisId_version_type: { analysisId, version, type: "converted" } },
    data: { llmScore: Math.round(data.quality_score) },
  });
  if (rawLlm !== null) {
    await db.snapshot.update({
      where: { analysisId_version_type: { analysisId, version, type: "raw" } },
      data: { llmScore: rawLlm },
    });
  }
  await db.analysis.update({
    where: { id: analysisId },
    data: {
      standardizedSummary: data.standardized_summary.slice(0, 500),
      targetAudience: data.target_audience,
      searchTerms: data.search_terms.slice(0, 8),
    },
  });
  for (const f of data.findings) {
    await db.finding.create({
      data: { analysisId, type: f.type, severity: f.severity, detail: f.detail, lastJobId: jobId,
        // location and evidence travel inside detail so the report can show them
        ...(f.evidence || f.location ? { detail: `${f.detail}${f.location ? ` [${f.location}]` : ""}${f.evidence ? ` "${f.evidence}"` : ""}` } : {}) },
    });
  }
  await saveMentions(analysisId, data.product_mentions);
  return data;
}

/** Stage 3: match incidents to content gaps and extract AI-ready knowledge (Call 2). */
async function enrichStage(article: Article, analysisId: string, analysis: AnalysisResult, converted: string) {
  const incidents = await findCandidateIncidents(analysis.search_terms);
  const gaps = await db.finding.findMany({
    where: { analysisId, state: "new", type: { in: [...CONTENT_GAP_TYPES] as never[] } },
    orderBy: { createdAt: "asc" },
  });
  const prompt = await renderPrompt("incident_enrichment", {
    title: article.title,
    kbname: article.knowledgeBase ?? "General",
    targetaudience: analysis.target_audience,
    qualityscore: String(Math.round(analysis.quality_score)),
    markdowncontent: converted,
    findings: formatFindings(analysis.findings.filter((f) => CONTENT_GAP_TYPES.has(f.type))),
    incidents: formatIncidents(incidents),
  });
  const { data } = await chatJson(prompt, enrichmentSchema, { think: true });

  const byNumber = new Map(incidents.map((i) => [i.number, i.id]));
  for (const row of data.incident_analysis.filter((r) => r.relevant && byNumber.has(r.incident_id))) {
    if (!gaps[0]) break;
    await db.evidence.upsert({
      where: { findingId_incidentId: { findingId: gaps[0].id, incidentId: byNumber.get(row.incident_id)! } },
      create: { findingId: gaps[0].id, incidentId: byNumber.get(row.incident_id)!, newInformation: row.new_information, contradictsArticle: row.contradicts_article },
      update: { newInformation: row.new_information, contradictsArticle: row.contradicts_article },
    });
  }
  await db.analysis.update({
    where: { id: analysisId },
    data: { enrichmentConfidence: data.confidence, enrichmentKnowledge: data as unknown as Prisma.InputJsonValue },
  });
  return data;
}

/** Stage 4: rewrite the article (Call 3), then score the rewrite like the other stages. */
async function synthesizeStage(
  article: Article, analysisId: string, jobId: string, version: number,
  analysis: AnalysisResult, enrichment: Awaited<ReturnType<typeof enrichStage>> | null, converted: string,
) {
  const prompt = await renderPrompt("article_synthesis", {
    title: article.title,
    articletype: "Knowledge article",
    kbname: article.knowledgeBase ?? "General",
    targetaudience: analysis.target_audience,
    currentdate: new Date().toISOString().slice(0, 10),
    original_content: converted,
    findings: formatFindings(analysis.findings),
    ai_ready_knowledge: jsonOrNone(enrichment?.ai_ready_knowledge.extractable ? enrichment.ai_ready_knowledge : null),
    contradictions: jsonOrNone(enrichment?.contradictions),
    recommendations: jsonOrNone(enrichment?.recommendations),
  });
  const { data } = await chatJson(prompt, synthesisSchema, { think: true });
  const llm = await llmScore(article, data.enriched_content);
  await db.snapshot.create({
    data: { analysisId, type: "enriched", version, content: data.enriched_content, llmScore: llm,
      ...mechanical(data.enriched_content), processingMessage: data.summary || null, processedAt: new Date(), lastJobId: jobId },
  });
}

/** The pipeline stages, in order. A failed item can be restarted from any of them. */
export const STAGES = ["convert", "analyze", "enrich", "rewrite"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Rebuild the analysis result from what an earlier run saved, so a restart can
 * pick up after the analyze stage without asking the model again.
 * @param analysisId the article's analysis
 * @param version the snapshot version being resumed
 * @return the same shape the analyze stage returns
 */
async function rebuildAnalysis(analysisId: string, version: number): Promise<AnalysisResult> {
  const a = await db.analysis.findUniqueOrThrow({ where: { id: analysisId } });
  const converted = await db.snapshot.findUnique({ where: { analysisId_version_type: { analysisId, version, type: "converted" } } });
  const findings = await db.finding.findMany({ where: { analysisId, state: "new", type: { not: "duplicate" } }, orderBy: { createdAt: "asc" } });
  return {
    quality_score: converted?.llmScore ?? 0,
    target_audience: a.targetAudience ?? "mixed",
    standardized_summary: a.standardizedSummary ?? "",
    findings: findings.map((f) => ({ type: f.type, severity: f.severity ?? "medium", location: "", evidence: "", detail: f.detail ?? "" })),
    search_terms: (a.searchTerms as string[]) ?? [],
    product_mentions: [],
    summary: "",
  };
}

/**
 * Run one article through the pipeline and record progress on its job item.
 * Starts at `fromStage`. Anything other than "convert" reuses the content and
 * results the earlier run already saved, so a restart repeats only the failed
 * stage and the ones after it. Never throws: a failure is recorded on the job
 * item along with the stage it happened in.
 * @param jobItemId the job item to process
 * @param fromStage where to start; defaults to the beginning
 */
export async function processJobItem(jobItemId: string, fromStage: Stage = "convert"): Promise<void> {
  const item = await db.jobItem.findUniqueOrThrow({ where: { id: jobItemId }, include: { article: true } });
  const { article, jobId } = item;
  let analysisId = item.analysisId;
  let stage: Stage = fromStage;
  // Prove we are alive while the model works. If the process dies, the beats stop and the reconciler takes over.
  const heartbeat = setInterval(() => {
    void db.jobItem
      .updateMany({ where: { id: item.id, claimedBy: WORKER_ID, status: { in: ["converting", "analyzing", "enriching", "scoring"] } }, data: { heartbeatAt: new Date() } })
      .catch(() => undefined);
  }, HEARTBEAT_MS);
  try {
    const existing = await db.analysis.findUnique({ where: { articleId: article.id } });

    // A restart needs what the earlier run saved. If it is missing, start from the top.
    let start = STAGES.indexOf(fromStage);
    let version = 0;
    let converted = "";
    if (start > 0) {
      const latest = existing ? await db.snapshot.findFirst({ where: { analysisId: existing.id }, orderBy: { version: "desc" } }) : null;
      const conv = latest && existing
        ? await db.snapshot.findUnique({ where: { analysisId_version_type: { analysisId: existing.id, version: latest.version, type: "converted" } } })
        : null;
      if (!existing || !latest || !conv) start = 0;
      else {
        analysisId = existing.id;
        version = latest.version;
        converted = conv.content;
      }
    }
    stage = STAGES[start];

    if (start === 0) {
      await setStatus(item.id, "converting");
      if (existing?.pipelineStage === "ready" && existing.sourceUpdatedAt && existing.sourceUpdatedAt >= article.updatedAt && item.restarts === 0) {
        await db.jobItem.update({ where: { id: item.id }, data: { status: "skipped", analysisId: existing.id, message: "Unchanged since last run" } });
        return;
      }
      const analysis = existing
        ? await db.analysis.update({ where: { id: existing.id }, data: { pipelineStage: "analyzing", lastJobId: jobId } })
        : await db.analysis.create({ data: { articleId: article.id, pipelineStage: "analyzing", lastJobId: jobId } });
      analysisId = analysis.id;
      await db.jobItem.update({ where: { id: item.id }, data: { analysisId } });
      await db.finding.updateMany({ where: { analysisId, state: { in: ["new", "acknowledged"] } }, data: { state: "cancelled" } });
      // A crash can leave a version with a raw snapshot but no converted one. Drop it so a re-run starts clean.
      const done = new Set((await db.snapshot.findMany({ where: { analysisId, type: "converted" }, select: { version: true } })).map((x) => x.version));
      const partial = (await db.snapshot.findMany({ where: { analysisId, type: "raw" }, select: { version: true } })).map((x) => x.version).filter((v) => !done.has(v));
      if (partial.length) await db.snapshot.deleteMany({ where: { analysisId, version: { in: partial } } });
      version = ((await db.snapshot.aggregate({ where: { analysisId }, _max: { version: true } }))._max.version ?? 0) + 1;
      converted = await convertStage(article, analysisId, jobId, version);
    }
    if (!analysisId) throw new Error("No analysis to continue from");

    let result: AnalysisResult;
    let dupes = 0;
    if (start <= 1) {
      stage = "analyze";
      await setStatus(item.id, "analyzing");
      await db.analysis.update({ where: { id: analysisId }, data: { pipelineStage: "analyzing", lastJobId: jobId } });
      if (start === 1) await db.finding.updateMany({ where: { analysisId, state: { in: ["new", "acknowledged"] } }, data: { state: "cancelled" } });
      result = await analyzeStage(article, analysisId, jobId, version, converted);
      dupes = await findDuplicates(jobId, analysisId, result.standardized_summary, result.search_terms);
    } else {
      result = await rebuildAnalysis(analysisId, version);
    }

    const needsEnrichment = result.findings.some((f) => CONTENT_GAP_TYPES.has(f.type));
    let enrichment: Awaited<ReturnType<typeof enrichStage>> | null = null;
    if (start <= 2 && needsEnrichment) {
      stage = "enrich";
      await setStatus(item.id, "enriching");
      await db.analysis.update({ where: { id: analysisId }, data: { pipelineStage: "restructuring" } });
      enrichment = await enrichStage(article, analysisId, result, converted);
    } else if (start === 3) {
      const saved = (await db.analysis.findUniqueOrThrow({ where: { id: analysisId } })).enrichmentKnowledge;
      enrichment = (saved as unknown as Awaited<ReturnType<typeof enrichStage>>) ?? null;
    }

    if (result.findings.length > 0) {
      stage = "rewrite";
      await setStatus(item.id, "scoring");
      await db.analysis.update({ where: { id: analysisId }, data: { pipelineStage: "validating" } });
      await db.snapshot.deleteMany({ where: { analysisId, version, type: "enriched" } });
      await synthesizeStage(article, analysisId, jobId, version, result, enrichment, converted);
    }

    await db.analysis.update({ where: { id: analysisId }, data: { pipelineStage: "ready", sourceUpdatedAt: article.updatedAt } });
    await setStatus(item.id, "completed");
    // Chat search is a side benefit. If indexing fails, the article is still refined.
    await indexArticle(article.id).catch((e) => console.warn(`[index] ${article.id}: ${(e as Error).message}`));
    await db.job.update({
      where: { id: jobId },
      data: { findingsGenerated: { increment: result.findings.length }, duplicatesFound: { increment: dupes } },
    });
  } catch (e) {
    // Another worker owns this item now. Stop quietly and leave its data alone.
    if (e instanceof ClaimLostError) return;
    const message = (e as Error).message.slice(0, 1000);
    const held = await db.jobItem.updateMany({ where: { id: item.id, claimedBy: WORKER_ID }, data: { status: "failed", message, failedStage: stage, heartbeatAt: new Date() } });
    if (held.count > 0 && analysisId) await db.analysis.update({ where: { id: analysisId }, data: { pipelineStage: "failed" } });
  } finally {
    clearInterval(heartbeat);
  }
}
