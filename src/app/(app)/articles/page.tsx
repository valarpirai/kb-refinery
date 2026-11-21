import Link from "next/link";
import { ArticleTable, type ArticleRow } from "@/components/article-table";
import type { DotStep } from "@/components/article-stage-dots";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPipelineStatus } from "@/lib/pipeline/status";
import { requirePageUser } from "@/lib/session";
import "./articles.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Articles · KB Refinery" };

const STAGES = ["all", "not_refined", "in_progress", "ready", "failed", "has_findings"] as const;
const SORTS = ["updated", "title", "score"] as const;
const SIZES = [10, 20, 50] as const;
const NO_KB = "__none";
const STAGE_LABELS: Record<(typeof STAGES)[number], string> = { all: "All stages", not_refined: "Not refined", in_progress: "In progress", ready: "Ready", failed: "Failed", has_findings: "Has open findings" };
const SORT_LABELS: Record<(typeof SORTS)[number], string> = { updated: "Last updated", title: "Title", score: "Score (rewritten, best first)" };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

interface Params {
  q: string;
  stage: (typeof STAGES)[number];
  kb: string;
  tag: string;
  sort: (typeof SORTS)[number];
  size: number;
  page: number;
}

/**
 * Read the URL search params into safe values.
 * @param sp raw search params
 * @return cleaned params; unknown values fall back to defaults
 */
function parse(sp: SearchParams): Params {
  const stage = one(sp.stage);
  const sort = one(sp.sort);
  const size = Number(one(sp.size));
  const page = Math.floor(Number(one(sp.page)));
  return {
    q: one(sp.q).trim().slice(0, 100),
    stage: (STAGES as readonly string[]).includes(stage) ? (stage as Params["stage"]) : "all",
    kb: one(sp.kb).slice(0, 200),
    tag: one(sp.tag).trim().toLowerCase().slice(0, 40),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as Params["sort"]) : "updated",
    size: (SIZES as readonly number[]).includes(size) ? size : 20,
    page: page >= 1 ? page : 1,
  };
}

/**
 * Build a /articles link that keeps current params and applies changes.
 * @param p current params
 * @param change values to set; an empty or default value removes the param
 * @return the href
 */
function href(p: Params, change: Partial<Record<keyof Params, string | number>> = {}): string {
  const merged: Record<string, string | number> = { ...p, ...change };
  const defaults: Record<string, string | number> = { q: "", stage: "all", kb: "", tag: "", sort: "updated", size: 20, page: 1 };
  const out = new URLSearchParams();
  for (const k of Object.keys(defaults)) if (merged[k] !== defaults[k] && merged[k] !== "") out.set(k, String(merged[k]));
  const s = out.toString();
  return s ? `/articles?${s}` : "/articles";
}

/** Page numbers to show: first, last, and a window around the current one, with null for a gap. */
function pageWindow(current: number, last: number): (number | null)[] {
  const keep = new Set([1, last, current - 1, current, current + 1].filter((n) => n >= 1 && n <= last));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/**
 * Latest mechanical score per (analysis, type), taking the highest version of each type.
 * @param analysisIds analyses to look up
 * @return map of analysisId to scores by type
 */
async function latestScores(analysisIds: string[]): Promise<Map<string, Partial<Record<"raw" | "converted" | "enriched", number>>>> {
  const out = new Map<string, Partial<Record<"raw" | "converted" | "enriched", number>>>();
  if (analysisIds.length === 0) return out;
  const rows = await db.$queryRaw<{ analysisId: string; type: "raw" | "converted" | "enriched"; score: number | null }[]>`
    SELECT DISTINCT ON ("analysisId", "type") "analysisId", "type"::text AS "type", "score"
    FROM "Snapshot"
    WHERE "analysisId" = ANY(${analysisIds}) AND "score" IS NOT NULL
    ORDER BY "analysisId", "type", "version" DESC`;
  for (const r of rows) {
    if (r.score === null) continue;
    const cur = out.get(r.analysisId) ?? {};
    cur[r.type] = r.score;
    out.set(r.analysisId, cur);
  }
  return out;
}

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const p = parse(await searchParams);

  const and: Prisma.ArticleWhereInput[] = [];
  if (p.q) and.push({ OR: [{ title: { contains: p.q, mode: "insensitive" } }, { knowledgeBase: { contains: p.q, mode: "insensitive" } }, { articleTags: { some: { tag: { name: { contains: p.q, mode: "insensitive" } } } } }] });
  if (p.stage === "not_refined") and.push({ analysis: { is: null } });
  if (p.stage === "in_progress") and.push({ analysis: { is: { pipelineStage: { notIn: ["ready", "failed"] } } } });
  if (p.stage === "ready" || p.stage === "failed") and.push({ analysis: { is: { pipelineStage: p.stage } } });
  if (p.stage === "has_findings") and.push({ analysis: { is: { findings: { some: { state: "new" } } } } });
  if (p.kb === NO_KB) and.push({ knowledgeBase: null });
  else if (p.kb) and.push({ knowledgeBase: p.kb });
  if (p.tag) and.push({ articleTags: { some: { tag: { name: p.tag } } } });
  const where: Prisma.ArticleWhereInput = and.length ? { AND: and } : {};

  const [total, anyArticles, kbGroups, tagCounts] = await Promise.all([
    db.article.count({ where }),
    db.article.count(),
    db.article.groupBy({ by: ["knowledgeBase"], _count: { _all: true }, orderBy: { knowledgeBase: "asc" } }),
    db.tag.findMany({ select: { name: true, _count: { select: { articles: true } } }, orderBy: [{ articles: { _count: "desc" } }, { name: "asc" }], take: 20 }),
  ]);

  const last = Math.max(1, Math.ceil(total / p.size));
  const page = Math.min(p.page, last);
  const skip = (page - 1) * p.size;

  // Which article ids are on this page. Score sort needs scores for every match, so it sorts ids in memory.
  let pageIds: string[];
  let preScores: Map<string, Partial<Record<"raw" | "converted" | "enriched", number>>> | null = null;
  if (p.sort === "score") {
    const all = await db.article.findMany({ where, select: { id: true, updatedAt: true, analysis: { select: { id: true } } } });
    preScores = await latestScores(all.flatMap((a) => (a.analysis ? [a.analysis.id] : [])));
    const key = (a: (typeof all)[number]) => {
      const s = a.analysis ? preScores!.get(a.analysis.id) : undefined;
      return s?.enriched ?? s?.converted ?? null;
    };
    all.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null && kb === null) return b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id);
      if (ka === null) return 1;
      if (kb === null) return -1;
      return kb - ka || b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id);
    });
    pageIds = all.slice(skip, skip + p.size).map((a) => a.id);
  } else {
    const rows = await db.article.findMany({ where, orderBy: p.sort === "title" ? [{ title: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }], skip, take: p.size, select: { id: true } });
    pageIds = rows.map((r) => r.id);
  }

  const articles = await db.article.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, title: true, knowledgeBase: true, updatedAt: true, analysis: { select: { id: true, pipelineStage: true } }, articleTags: { select: { tag: { select: { id: true, name: true } } }, orderBy: { tag: { name: "asc" } } } },
  });
  const byId = new Map(articles.map((a) => [a.id, a]));
  const analysisIds = articles.flatMap((a) => (a.analysis ? [a.analysis.id] : []));
  const [scores, findingGroups, statuses] = await Promise.all([
    preScores ? Promise.resolve(preScores) : latestScores(analysisIds),
    analysisIds.length ? db.finding.groupBy({ by: ["analysisId"], where: { analysisId: { in: analysisIds }, state: "new" }, _count: { _all: true } }) : Promise.resolve([]),
    Promise.all(pageIds.map((id) => getPipelineStatus(id))),
  ]);
  const openByAnalysis = new Map(findingGroups.map((g) => [g.analysisId, g._count._all]));
  const statusById = new Map(statuses.flatMap((s) => (s ? [[s.articleId, s] as const] : [])));

  const rows: ArticleRow[] = pageIds.flatMap((id) => {
    const a = byId.get(id);
    if (!a) return [];
    const s = a.analysis ? scores.get(a.analysis.id) : undefined;
    const steps: DotStep[] = (statusById.get(id)?.steps ?? []).map((st) => ({ key: st.key, label: st.label, state: st.state }));
    return [{
      id,
      title: a.title,
      knowledgeBase: a.knowledgeBase,
      stage: a.analysis?.pipelineStage ?? null,
      rawScore: s?.raw ?? null,
      rewrittenScore: s?.enriched ?? null,
      openFindings: a.analysis ? (openByAnalysis.get(a.analysis.id) ?? 0) : 0,
      tags: a.articleTags.map((t) => t.tag),
      updatedAt: a.updatedAt.toISOString(),
      steps,
    }];
  });

  const kbs = kbGroups.map((g) => g.knowledgeBase).filter((k): k is string => !!k);
  const hasNoKb = kbGroups.some((g) => g.knowledgeBase === null);
  const active: { text: string; remove: string }[] = [];
  if (p.q) active.push({ text: `Search: ${p.q}`, remove: href(p, { q: "", page: 1 }) });
  if (p.stage !== "all") active.push({ text: `Stage: ${STAGE_LABELS[p.stage]}`, remove: href(p, { stage: "all", page: 1 }) });
  if (p.kb) active.push({ text: `Knowledge base: ${p.kb === NO_KB ? "None" : p.kb}`, remove: href(p, { kb: "", page: 1 }) });
  if (p.tag) active.push({ text: `Tag: ${p.tag}`, remove: href(p, { tag: "", page: 1 }) });

  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + p.size, total);
  const field = "rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20";
  const btn = "art-hover art-press rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20";

  return (
    <div className="art-root space-y-5">
      <h1 className="text-2xl font-semibold">Articles</h1>

      {anyArticles === 0 ? (
        <p className="text-sm opacity-80">
          There are no articles yet. <Link href="/import" className="text-blue-700 underline dark:text-blue-300">Import some</Link> to get started.
        </p>
      ) : (
        <>
          <form method="get" action="/articles" className="flex flex-wrap items-end gap-3" aria-label="Filter articles">
            <div className="flex flex-col gap-1">
              <label htmlFor="f-q" className="text-xs font-medium">Search</label>
              <input id="f-q" name="q" type="search" defaultValue={p.q} placeholder="Title, knowledge base or tag" className={`${field} w-56`} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-stage" className="text-xs font-medium">Stage</label>
              <select id="f-stage" name="stage" defaultValue={p.stage} className={field}>
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-kb" className="text-xs font-medium">Knowledge base</label>
              <select id="f-kb" name="kb" defaultValue={p.kb} className={`${field} max-w-48`}>
                <option value="">All knowledge bases</option>
                {hasNoKb && <option value={NO_KB}>No knowledge base</option>}
                {kbs.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-tag" className="text-xs font-medium">Tag</label>
              <input id="f-tag" name="tag" type="text" defaultValue={p.tag} placeholder="Exact tag" className={`${field} w-32`} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-sort" className="text-xs font-medium">Sort by</label>
              <select id="f-sort" name="sort" defaultValue={p.sort} className={field}>
                {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-size" className="text-xs font-medium">Per page</label>
              <select id="f-size" name="size" defaultValue={p.size} className={field}>
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button type="submit" className="art-press art-hover-solid rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white">Apply</button>
            <Link href="/articles" className={btn}>Reset</Link>
          </form>

          {tagCounts.length > 0 && (
            <nav aria-label="Popular tags" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-medium">Tags</span>
              {tagCounts.map((t) => (
                <Link key={t.name} href={href(p, { tag: t.name === p.tag ? "" : t.name, page: 1 })} aria-current={t.name === p.tag ? "true" : undefined} className={`art-hover rounded-full border px-2.5 py-0.5 text-xs ${t.name === p.tag ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : "border-black/15 dark:border-white/20"}`}>
                  {t.name} <span className="opacity-60">{t._count.articles}</span>
                </Link>
              ))}
            </nav>
          )}

          {active.length > 0 && (
            <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2 text-sm">
              {active.map((a) => (
                <li key={a.text} className="inline-flex items-center gap-1 rounded-full bg-blue-100 py-0.5 pl-3 pr-1 text-xs text-blue-900 dark:bg-blue-900/50 dark:text-blue-200">
                  {a.text}
                  <Link href={a.remove} aria-label={`Remove filter ${a.text}`} className="art-hover inline-flex size-5 items-center justify-center rounded-full"><span aria-hidden="true">×</span></Link>
                </li>
              ))}
            </ul>
          )}

          {total === 0 ? (
            <div className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
              <p>No articles match{active.length ? ` ${active.map((a) => a.text).join("; ")}` : ""}.</p>
              <Link href="/articles" className="mt-2 inline-block text-blue-700 underline dark:text-blue-300">Reset filters</Link>
            </div>
          ) : (
            <>
              <p className="text-sm" aria-live="polite">Showing {from}–{to} of {total}</p>
              <ArticleTable rows={rows} canDelete={user.role === "admin"} />
              {last > 1 && (
                <nav aria-label="Pagination" className="flex flex-wrap items-center gap-1 text-sm">
                  {page > 1 ? <Link href={href(p, { page: page - 1 })} rel="prev" className={btn}>Previous</Link> : <span className={`${btn} opacity-40`} aria-disabled="true">Previous</span>}
                  {pageWindow(page, last).map((n, i) =>
                    n === null ? (
                      <span key={`gap${i}`} aria-hidden="true" className="px-1">…</span>
                    ) : n === page ? (
                      <span key={n} aria-current="page" className="rounded border border-blue-600 bg-blue-50 px-3 py-1.5 font-medium dark:bg-blue-950">{n}</span>
                    ) : (
                      <Link key={n} href={href(p, { page: n })} aria-label={`Page ${n}`} className={btn}>{n}</Link>
                    ),
                  )}
                  {page < last ? <Link href={href(p, { page: page + 1 })} rel="next" className={btn}>Next</Link> : <span className={`${btn} opacity-40`} aria-disabled="true">Next</span>}
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
