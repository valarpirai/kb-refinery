"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/status-pill";

interface Item {
  id: string;
  status: string;
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

/** Live view of one job. Polls every 3 seconds until the job finishes. */
export function JobProgress({ initial }: { initial: JobData }) {
  const [job, setJob] = useState(initial);

  useEffect(() => {
    if (FINISHED.includes(job.status)) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (res.ok) setJob(await res.json());
      } catch {
        /* keep the last good state and try again */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [job.id, job.status]);

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
                <td className="pr-4"><StatusPill status={i.status} /></td>
                <td className="max-w-md truncate text-xs opacity-80" title={i.message ?? undefined}>{i.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
