import { db } from "@/lib/db";
import { STAGES, type Stage } from "./run-article";

export type StepState = "done" | "active" | "queued" | "failed" | "pending" | "skipped";

export interface PipelineStep {
  key: "import" | Stage | "ready";
  label: string;
  state: StepState;
}

export interface PipelineStatus {
  articleId: string;
  analysisId: string | null;
  steps: PipelineStep[];
  /** True while the worker is still on this article. The page polls only then. */
  running: boolean;
  item: { id: string; status: string; failedStage: Stage | null; message: string | null; restarts: number; jobId: string; updatedAt: string } | null;
  /** Stages you may restart from. Empty unless the last run failed. */
  restartFrom: Stage[];
}

const LABELS: Record<PipelineStep["key"], string> = {
  import: "Imported", convert: "Convert", analyze: "Analyze", enrich: "Enrich", rewrite: "Rewrite", ready: "Ready",
};
const ACTIVE: Record<string, Stage> = { converting: "convert", analyzing: "analyze", enriching: "enrich", scoring: "rewrite" };

/**
 * Work out where an article is in the pipeline, in a shape a page can draw directly.
 * @param articleId the article
 * @return one state per step, plus the latest job item and which stages can be restarted
 */
export async function getPipelineStatus(articleId: string): Promise<PipelineStatus | null> {
  const article = await db.article.findUnique({ where: { id: articleId }, select: { id: true } });
  if (!article) return null;
  const [analysis, item] = await Promise.all([
    db.analysis.findUnique({ where: { articleId } }),
    db.jobItem.findFirst({ where: { articleId }, orderBy: { updatedAt: "desc" } }),
  ]);

  const states = new Map<PipelineStep["key"], StepState>([["import", "done"]]);
  for (const k of [...STAGES, "ready"] as const) states.set(k, "pending");
  let running = false;
  let restartFrom: Stage[] = [];

  /** Mark stages before `index` done and the rest pending. */
  const upTo = (index: number) => STAGES.forEach((k, i) => states.set(k, i < index ? "done" : "pending"));

  if (item && item.status in ACTIVE) {
    const i = STAGES.indexOf(ACTIVE[item.status]);
    upTo(i);
    states.set(STAGES[i], "active");
    running = true;
  } else if (item?.status === "pending") {
    // A restarted item keeps its resume point in failedStage; a fresh one starts at convert.
    const at = (item.failedStage as Stage | null) ?? "convert";
    upTo(STAGES.indexOf(at));
    states.set(at, "queued");
    running = true;
  } else if (item?.status === "failed") {
    const failed = (item.failedStage as Stage | null) ?? "convert";
    const i = STAGES.indexOf(failed);
    upTo(i);
    states.set(failed, "failed");
    restartFrom = STAGES.slice(0, i + 1) as Stage[];
  } else if (analysis?.pipelineStage === "ready") {
    const latest = await db.snapshot.findFirst({ where: { analysisId: analysis.id }, orderBy: { version: "desc" }, select: { version: true } });
    const rewrote = latest ? (await db.snapshot.count({ where: { analysisId: analysis.id, version: latest.version, type: "enriched" } })) > 0 : false;
    STAGES.forEach((k) => states.set(k, "done"));
    if (!analysis.enrichmentKnowledge) states.set("enrich", "skipped");
    if (!rewrote) states.set("rewrite", "skipped");
    states.set("ready", "done");
  }

  return {
    articleId,
    analysisId: analysis?.id ?? null,
    steps: (["import", ...STAGES, "ready"] as const).map((key) => ({ key, label: LABELS[key], state: states.get(key) ?? "pending" })),
    running,
    item: item
      ? { id: item.id, status: item.status, failedStage: (item.failedStage as Stage | null) ?? null, message: item.message, restarts: item.restarts, jobId: item.jobId, updatedAt: item.updatedAt.toISOString() }
      : null,
    restartFrom,
  };
}
