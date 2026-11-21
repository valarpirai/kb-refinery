import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { runImport } from "@/lib/ingest/import";
import { createJob } from "@/lib/pipeline/jobs";
import { restartJobItem } from "@/lib/pipeline/restart";
import { crawl } from "./crawl";

export interface ToolContext {
  userId: string;
}

/** Make a name safe and stable for a file, so a repeat import updates the same article. */
function slugFor(url: string): string {
  const u = new URL(url);
  return `${u.hostname}${u.pathname}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "page";
}

const json = (value: unknown) => JSON.stringify(value);

/**
 * The tools the refinery agent can call. Each one is bound to the signed-in user.
 * @param ctx who the agent is working for
 * @param enabled tool names the agent may call; omit for all of them
 * @return Strands tools
 */
export function buildTools(ctx: ToolContext, enabled?: string[]) {
  const importFromUrl = tool({
    name: "import_from_url",
    description:
      "Fetch a web page, and optionally the other pages it links to on the same site, and import them as knowledge base articles. " +
      "Use this when the user gives a website or URL. It does not refine them; call start_refine afterwards.",
    inputSchema: z.object({
      url: z.string().describe("Full address, starting with http:// or https://"),
      only_this_page: z.boolean().default(false).describe("Set true ONLY when the user asks for a single page. Normally leave it out so linked pages are fetched too."),
      max_pages: z.number().int().min(1).max(50).default(10).describe("Most pages to fetch. Leave it out unless the user names a number."),
    }),
    callback: async ({ url, only_this_page, max_pages }) => {
      let result;
      try {
        result = await crawl(url, only_this_page ? 1 : Math.max(max_pages, 2), !only_this_page);
      } catch (e) {
        return json({ ok: false, error: (e as Error).message });
      }
      if (result.pages.length === 0) return json({ ok: false, error: result.errors[0] ?? "No pages could be fetched", problems: result.errors.slice(0, 3) });
      const run = await runImport({
        kind: "articles",
        label: `Website: ${new URL(url).hostname}`,
        userId: ctx.userId,
        files: result.pages.map((p) => ({ name: `${slugFor(p.url)}.html`, text: p.html, url: p.url })),
      });
      return json({
        ok: true,
        import_run_id: run.id,
        pages_fetched: result.pages.length,
        created: run.created,
        updated: run.updated,
        unchanged: run.skipped,
        problems: [...result.errors, ...(run.errors as string[])].slice(0, 3),
      });
    },
  });

  const startRefine = tool({
    name: "start_refine",
    description:
      "Start refining articles in the background. Pass the import_run_id from import_from_url to refine what that import created or changed, " +
      "or a list of article ids. Returns at once with a job id. The user is notified when the job finishes.",
    inputSchema: z.object({
      import_run_id: z.string().optional().describe("Refine the articles this import created or updated"),
      article_ids: z.array(z.string()).optional().describe("Specific article ids"),
    }),
    callback: async ({ import_run_id, article_ids }) => {
      let ids = article_ids;
      if (!ids && import_run_id) {
        ids = (await db.article.findMany({ where: { importRunId: import_run_id }, select: { id: true }, take: 100 })).map((a) => a.id);
      }
      if (!ids || ids.length === 0) return json({ ok: false, error: "Nothing to refine. Give an import_run_id with new or changed articles, or article_ids." });
      const job = await createJob(ids, `${ids.length} article(s) started by the agent`, ctx.userId);
      return json({ ok: true, job_id: job.id, articles: ids.length, note: "Running in the background. The user will be notified when it finishes." });
    },
  });

  const restartFailed = tool({
    name: "restart_failed",
    description:
      "Queue articles whose latest refine run failed to run again, from the stage that failed. Use it when the user asks to refine, retry or restart failed articles. " +
      "No input needed: it finds them itself. Returns the titles it queued. The user is notified when the job finishes.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(25).describe("Most articles to queue. Leave it out unless the user names a number."),
    }),
    callback: async ({ limit }) => {
      // Newest failed item per article, skipping any article that a later run has since fixed or restarted.
      const failed = await db.jobItem.findMany({
        where: { status: "failed" },
        orderBy: { updatedAt: "desc" },
        distinct: ["articleId"],
        take: limit,
        include: { article: { select: { title: true } } },
      });
      const queued: { title: string; from_stage: string; job_id: string }[] = [];
      const skipped: string[] = [];
      for (const item of failed) {
        const newer = await db.jobItem.count({ where: { articleId: item.articleId, status: { not: "failed" }, updatedAt: { gt: item.updatedAt } } });
        if (newer > 0) continue;
        const r = await restartJobItem(item.id);
        if (r.ok) queued.push({ title: item.article.title, from_stage: r.fromStage, job_id: item.jobId });
        else skipped.push(`${item.article.title}: ${r.error}`);
      }
      if (queued.length === 0 && skipped.length === 0) return json({ ok: true, queued: 0, note: "No failed articles to restart." });
      return json({ ok: true, queued: queued.length, articles: queued, skipped, note: "Running in the background. The user will be notified when it finishes." });
    },
  });

  const jobStatus = tool({
    name: "get_job_status",
    description: "Check a refine job: its status and how many articles are in each stage. With no job_id, checks the user's latest job.",
    inputSchema: z.object({ job_id: z.string().optional() }),
    callback: async ({ job_id }) => {
      const job = job_id
        ? await db.job.findUnique({ where: { id: job_id } })
        : await db.job.findFirst({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" } });
      if (!job) return json({ ok: false, error: "No job found" });
      const items = await db.jobItem.groupBy({ by: ["status"], where: { jobId: job.id }, _count: true });
      return json({
        ok: true, job_id: job.id, status: job.status, scope: job.scope, articles: job.articlesTotal,
        by_stage: Object.fromEntries(items.map((i) => [i.status, i._count])),
        findings: job.findingsGenerated, duplicates: job.duplicatesFound,
      });
    },
  });

  const getStats = tool({
    name: "get_stats",
    description:
      "Get statistics about the knowledge base: article counts, how many are refined, open findings by severity, average quality scores before and after refining, " +
      "top products, recent jobs, and chat comparison results. Use it for any question about numbers or overall quality.",
    inputSchema: z.object({}),
    callback: async () => {
      const [articles, byStage, findings, scores, products, jobs, indexed, verdicts] = await Promise.all([
        db.article.count(),
        db.analysis.groupBy({ by: ["pipelineStage"], _count: true }),
        db.finding.groupBy({ by: ["severity"], where: { state: "new" }, _count: true }),
        db.snapshot.groupBy({ by: ["type"], _avg: { score: true, llmScore: true } }),
        db.product.findMany({ where: { articleCount: { gt: 0 } }, orderBy: { articleCount: "desc" }, take: 5, select: { name: true, articleCount: true } }),
        db.job.groupBy({ by: ["status"], _count: true }),
        db.chunk.groupBy({ by: ["variant"], _count: true }),
        db.comparison.groupBy({ by: ["verdict"], where: { conversation: { userId: ctx.userId }, verdict: { not: null } }, _count: true }),
      ]);
      const round = (n: number | null | undefined) => (n == null ? null : Math.round(n));
      return json({
        articles,
        analysis_stages: Object.fromEntries(byStage.map((s) => [s.pipelineStage, s._count])),
        open_findings_by_severity: Object.fromEntries(findings.map((f) => [f.severity ?? "unrated", f._count])),
        average_scores: Object.fromEntries(scores.map((s) => [s.type, { mechanical: round(s._avg.score), model: round(s._avg.llmScore) }])),
        top_products: products,
        jobs_by_status: Object.fromEntries(jobs.map((j) => [j.status, j._count])),
        chat_index_chunks: Object.fromEntries(indexed.map((i) => [i.variant, i._count])),
        your_comparison_verdicts: Object.fromEntries(verdicts.map((v) => [v.verdict as string, v._count])),
      });
    },
  });

  const searchArticles = tool({
    name: "search_articles",
    description: "Find articles by words in the title. Returns up to 10 with their stage and scores. Use it to look up one article or a topic.",
    inputSchema: z.object({ query: z.string().min(1).describe("Words from the title") }),
    callback: async ({ query }) => {
      const rows = await db.article.findMany({
        where: { title: { contains: query, mode: "insensitive" } },
        take: 10,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, knowledgeBase: true, url: true, analysis: { select: { id: true, pipelineStage: true, _count: { select: { findings: { where: { state: "new" } } } } } } },
      });
      return json(rows.map((r) => ({
        article_id: r.id, title: r.title, knowledge_base: r.knowledgeBase, url: r.url,
        stage: r.analysis?.pipelineStage ?? "not refined", open_findings: r.analysis?._count.findings ?? 0,
        report: r.analysis ? `/analysis/${r.analysis.id}` : null,
      })));
    },
  });

  const all = [importFromUrl, startRefine, restartFailed, jobStatus, getStats, searchArticles];
  return enabled ? all.filter((t) => enabled.includes(t.name)) : all;
}
