"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { restartItem, STAGE_LABEL } from "@/components/pipeline-restart";
import { StatusPill } from "@/components/status-pill";
import { STAGE_COLORS } from "@/lib/colors";
import { label } from "@/lib/format";
import type { Stage } from "@/lib/pipeline/run-article";

interface Item {
  id: string;
  status: string;
  failedStage?: string | null;
  message: string | null;
  article: { id: string; title: string; knowledgeBase: string | null };
  analysis: { id: string; pipelineStage: string } | null;
}
export interface JobData {
  id: string;
  status: string;
  scope: string | null;
  articlesTotal: number;
  findingsGenerated: number;
  duplicatesFound: number;
  errorMessage: string | null;
  items: Item[];
}

const STAGES = ["pending", "converting", "analyzing", "enriching", "scoring", "completed", "skipped", "failed"] as const;
const FINISHED = ["completed", "completed_with_errors", "failed"];
const BUSY_ITEM = ["pending", "converting", "analyzing", "enriching", "scoring"];
const ITEM_STAGE = { converting: "convert", analyzing: "analyze", enriching: "enrich", scoring: "rewrite" } as const;

/** Status pill that takes the stage color while an item is in progress. The text always names the state. */
function ItemPill({ status }: { status: string }) {
  const stage = ITEM_STAGE[status as keyof typeof ITEM_STAGE];
  if (!stage) return <StatusPill status={status} />;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[stage].soft}`}>{label(status)}</span>;
}

/** Live view of one job. Polls every 3 seconds until the job finishes. */
export function JobProgress({ initial }: { initial: JobData }) {
  const [job, setJob] = useState(initial);

  const [restarting, setRestarting] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Fetch the latest job state. */
  async function refresh() {
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    } catch {
      /* keep the last good state and try again */
    }
  }

  // A restarted item can reopen a finished job, so keep polling while any item is still busy.
  const live = !FINISHED.includes(job.status) || job.items.some((i) => BUSY_ITEM.includes(i.status));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, live]);

  async function restart(itemId: string, stage: Stage) {
    setRestarting(itemId);
    setErrors((e) => ({ ...e, [itemId]: "" }));
    const err = await restartItem(itemId, stage);
    setRestarting(null);
    if (err) setErrors((e) => ({ ...e, [itemId]: err }));
    else await refresh();
  }

  const counts = Object.fromEntries(STAGES.map((s) => [s, job.items.filter((i) => i.status === s).length]));
  const done = counts.completed + counts.skipped + counts.failed;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{job.scope ?? "Job"}</h1>
        <StatusPill status={job.status} />
      </div>

      <div>
        <div
          role="progressbar"
          aria-label="Articles finished"
          aria-valuemin={0}
          aria-valuemax={job.articlesTotal}
          aria-valuenow={done}
          className="h-2 w-full overflow-hidden rounded bg-black/10 dark:bg-white/15"
        >
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${job.articlesTotal ? (done / job.articlesTotal) * 100 : 0}%` }} />
        </div>
        <p className="mt-2 text-sm" aria-live="polite">
          {done} of {job.articlesTotal} finished · {job.findingsGenerated} findings · {job.duplicatesFound} duplicate pair(s)
        </p>
      </div>

      <ul className="flex flex-wrap gap-2 text-sm">
        {STAGES.filter((s) => counts[s] > 0).map((s) => (
          <li key={s} className="flex items-center gap-2"><StatusPill status={s} /> {counts[s]}</li>
        ))}
      </ul>

      {job.errorMessage && <p className="text-sm text-red-600">{job.errorMessage}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-black/10 dark:border-white/15">
            <tr><th className="py-2 pr-4">Article</th><th className="pr-4">Status</th><th>Note</th></tr>
          </thead>
          <tbody>
            {job.items.map((i) => (
              <tr key={i.id} className="border-b border-black/5 dark:border-white/10">
                <td className="py-2 pr-4">
                  {i.analysis ? (
                    <Link href={`/analysis/${i.analysis.id}`} className="text-blue-700 hover:underline dark:text-blue-300">{i.article.title}</Link>
                  ) : (
                    i.article.title
                  )}
                  <span className="block text-xs opacity-70">{i.article.knowledgeBase}</span>
                </td>
                <td className="pr-4"><ItemPill status={i.status} /></td>
                <td className="max-w-md text-xs">
                  {i.status === "failed" ? (
                    <div className="space-y-1">
                      <details>
                        <summary className="cursor-pointer font-medium text-red-700 dark:text-red-300">
                          <span aria-hidden="true">⚠ </span>Failed at {STAGE_LABEL[(i.failedStage as Stage) ?? "convert"] ?? i.failedStage} · details
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-red-50 p-2 font-mono text-red-900 dark:bg-red-950/30 dark:text-red-100" tabIndex={0}>{i.message || "No error message was recorded."}</pre>
                      </details>
                      <button
                        type="button"
                        disabled={restarting === i.id}
                        onClick={() => void restart(i.id, (i.failedStage as Stage) ?? "convert")}
                        className="rounded border border-red-600 px-2 py-1 font-medium text-red-700 transition-transform duration-100 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 dark:text-red-300"
                      >
                        {restarting === i.id ? "Restarting…" : `Restart from ${STAGE_LABEL[(i.failedStage as Stage) ?? "convert"]}`}
                      </button>
                      <p className="text-red-700 dark:text-red-300" aria-live="polite">{errors[i.id]}</p>
                    </div>
                  ) : (
                    <span className="block truncate opacity-80" title={i.message ?? undefined}>{i.message}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
