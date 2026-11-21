"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { STAGE_COLORS } from "@/lib/colors";
import type { Stage } from "@/lib/pipeline/run-article";
import { useLive } from "@/lib/use-live";
import type { PipelineStatus, PipelineStep, StepState } from "@/lib/pipeline/status";
import { restartItem, STAGE_LABEL } from "./pipeline-restart";
import "./pipeline.css";

const STATE_TEXT: Record<StepState, string> = { done: "Done", active: "Running", queued: "Queued", failed: "Failed", pending: "Waiting", skipped: "Skipped" };
const DOING: Record<string, string> = { convert: "converting", analyze: "analyzing", enrich: "enriching", rewrite: "rewriting" };

/**
 * Write one sentence that sums up where the article is.
 * @param steps the pipeline steps
 * @return a sentence for screen readers and the caption
 */
function summarize(steps: PipelineStep[]): string {
  const stages = steps.filter((s) => s.key !== "import");
  const done = stages.filter((s) => s.state === "done" || s.state === "skipped").length;
  const count = `${done} of ${stages.length} stages done.`;
  const active = steps.find((s) => s.state === "active");
  if (active) return `Currently ${DOING[active.key] ?? active.label.toLowerCase()}. ${count}`;
  const queued = steps.find((s) => s.state === "queued");
  if (queued) return `${queued.label} is queued. ${count}`;
  const failed = steps.find((s) => s.state === "failed");
  if (failed) return `Failed at ${failed.label}. ${count}`;
  if (steps.every((s) => s.state === "done" || s.state === "skipped")) return "Pipeline finished. Ready.";
  return `Not started. ${count}`;
}

function Icon({ state, animate }: { state: StepState; animate: boolean }) {
  const cls = animate ? "pl-pop" : undefined;
  if (state === "done") {
    return (
      <svg key="done" className={cls} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 8.5l3.2 3.2L13 4.8" />
      </svg>
    );
  }
  if (state === "failed") return <span aria-hidden="true">!</span>;
  if (state === "skipped") return <span aria-hidden="true">–</span>;
  if (state === "active") return <span aria-hidden="true" className="block size-2.5 rounded-full bg-current" />;
  return null;
}

function Step({ step, index, total, prev }: { step: PipelineStep; index: number; total: number; prev: StepState | null }) {
  const colors = STAGE_COLORS[step.key];
  const { state } = step;
  // Only animate a check mark that appears after mount, never one that was already there.
  const [initialState] = useState(state);
  const animate = state !== initialState;

  const dot =
    state === "done" ? `${colors.solid} text-white`
    : state === "failed" ? "border-red-600 bg-red-600 text-white"
    : state === "active" ? `${colors.border} bg-white ${colors.text} dark:bg-black`
    : state === "queued" ? `${colors.border} ${colors.text} bg-transparent`
    : "border-slate-400 text-slate-500 bg-transparent dark:text-slate-400";

  const inFilled = state === "done" || state === "active" || state === "failed" || state === "skipped" || prev === "done";
  const outFilled = state === "done" || state === "skipped";
  const failedIn = state === "failed";

  return (
    <li className="flex gap-3 md:flex-1 md:flex-col md:gap-2" aria-current={state === "active" ? "step" : undefined} data-step={step.key}>
      <div className="pl-rail">
        <span className="pl-seg" data-hidden={index === 0} data-filled={inFilled && index > 0} data-sweep={state === "active" && index > 0}>
          <span className={`pl-seg-fill ${failedIn ? "bg-red-600" : colors.solid}`} />
        </span>
        <span className={`pl-node ${colors.text}`} data-state={state}>
          <span className={`pl-dot ${dot}`} data-state={state}>
            <Icon state={state} animate={animate} />
          </span>
        </span>
        <span className="pl-seg" data-hidden={index === total - 1} data-filled={outFilled && index < total - 1}>
          <span className={`pl-seg-fill ${colors.solid}`} />
        </span>
      </div>
      <div className="flex flex-col justify-center pb-2 md:items-center md:pb-0 md:text-center">
        <span className={state === "active" ? "text-base font-bold" : "text-sm font-medium"}>{step.label}</span>
        <span className={`text-xs ${state === "failed" ? "font-semibold text-red-700 dark:text-red-300" : state === "active" ? `font-semibold ${colors.text}` : "opacity-70"}`}>
          {state === "failed" && <span aria-hidden="true">⚠ </span>}
          {STATE_TEXT[state]}
        </span>
      </div>
    </li>
  );
}

/**
 * Animated pipeline stepper for one article, with error details and restart.
 * Updates live: the server pushes a signal when this article changes.
 * @param props.articleId the article to follow
 * @param props.initial the server-rendered status
 */
export function PipelineTunnel({ articleId, initial }: { articleId: string; initial: PipelineStatus }) {
  const [status, setStatus] = useState(initial);
  const [from, setFrom] = useState<Stage | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inflight = useRef<AbortController | null>(null);

  /** Fetch the latest status. A newer request cancels an older one still in flight. */
  const load = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const res = await fetch(`/api/articles/${articleId}/pipeline`, { cache: "no-store", signal: ctrl.signal });
      if (res.ok && !ctrl.signal.aborted) setStatus((await res.json()) as PipelineStatus);
    } catch {
      /* keep the last good state; the next change or reconnect refetches */
    }
  }, [articleId]);

  useEffect(() => () => inflight.current?.abort(), []);

  // Refetch when the server says this article changed, and after a reconnect (null).
  useLive((e) => {
    if (e === null || e.article === articleId) void load();
  });

  const item = status.item;
  const failedStage = item?.failedStage ?? null;
  const canRestart = status.restartFrom.length > 0 && item !== null;

  /** Restart and optimistically show the stage as queued so polling can take over. */
  async function restart(stage: Stage) {
    if (!item) return;
    setBusy(true);
    setError(null);
    const err = await restartItem(item.id, stage);
    setBusy(false);
    if (err) return setError(err);
    const at = status.steps.findIndex((s) => s.key === stage);
    setFrom("");
    setStatus({
      ...status,
      running: true,
      restartFrom: [],
      item: { ...item, status: "pending", failedStage: stage, message: null },
      steps: status.steps.map((s, i) => ({ ...s, state: i === at ? "queued" : i < at ? "done" : "pending" })),
    });
  }

  const steps = status.steps;
  return (
    <div className="space-y-4">
      <ol className="flex flex-col md:flex-row" aria-label="Pipeline stages">
        {steps.map((s, i) => (
          <Step key={s.key} step={s} index={i} total={steps.length} prev={i > 0 ? steps[i - 1].state : null} />
        ))}
      </ol>
      <p className="text-sm" role="status" aria-live="polite">{summarize(steps)}</p>

      {canRestart && item && (
        <div className="pl-panel space-y-3 rounded border border-red-600/40 bg-red-50 p-4 dark:bg-red-950/30" role="alert">
          <p className="font-semibold text-red-800 dark:text-red-200">
            <span aria-hidden="true">⚠ </span>Stage {failedStage ? STAGE_LABEL[failedStage] : "Convert"} failed
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70 p-3 font-mono text-xs text-red-900 dark:bg-black/40 dark:text-red-100" tabIndex={0} aria-label="Error message">
            {item.message || "No error message was recorded."}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void restart(failedStage ?? "convert")}
              className="pl-btn rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
            >
              {busy ? "Restarting…" : `Restart from ${STAGE_LABEL[failedStage ?? "convert"]}`}
            </button>
            {status.restartFrom.length > 1 && (
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <span>or restart from an earlier stage</span>
                <select
                  value={from}
                  disabled={busy}
                  onChange={(e) => setFrom(e.target.value as Stage | "")}
                  className="rounded border border-black/20 bg-transparent px-2 py-1 dark:border-white/30"
                >
                  <option value="">Choose a stage</option>
                  {status.restartFrom.slice(0, -1).map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
                </select>
                <button
                  type="button"
                  disabled={busy || !from}
                  onClick={() => from && void restart(from)}
                  className="pl-btn rounded border border-red-600 px-3 py-1 text-sm font-medium text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 dark:text-red-300"
                >
                  Restart
                </button>
              </label>
            )}
          </div>
          <p className="text-xs opacity-80">Starting earlier re-runs every stage after it, so it takes longer.</p>
          <p className="text-sm text-red-700 dark:text-red-300" aria-live="polite">{error}</p>
          <p className="text-xs opacity-80">
            {item.restarts > 0 && <>Restarted {item.restarts} {item.restarts === 1 ? "time" : "times"}. </>}
            <Link href={`/jobs/${item.jobId}`} className="text-blue-700 underline dark:text-blue-300">View job</Link>
          </p>
        </div>
      )}
    </div>
  );
}
