import { STAGE_COLORS } from "@/lib/colors";

export type DotState = "done" | "active" | "queued" | "failed" | "pending" | "skipped";
export interface DotStep {
  key: keyof typeof STAGE_COLORS;
  label: string;
  state: DotState;
}

/**
 * Plain-words summary of a pipeline, so color is never the only signal.
 * @param steps the six pipeline steps
 * @return text such as "analyze failed" or "ready"
 */
export function summarizeSteps(steps: DotStep[]): string {
  const failed = steps.find((s) => s.state === "failed");
  if (failed) return `${failed.key} failed`;
  const active = steps.find((s) => s.state === "active");
  if (active) return `${active.key} running`;
  const queued = steps.find((s) => s.state === "queued");
  if (queued) return `${queued.key} queued`;
  if (steps.find((s) => s.key === "ready")?.state === "done") return "ready";
  return "not started";
}

/** Six small static dots, one per pipeline step. Done is solid, active and queued are ringed, failed is red with "!". */
export function ArticleStageDots({ steps }: { steps: DotStep[] }) {
  const summary = `Pipeline: ${summarizeSteps(steps)}`;
  return (
    <span role="img" aria-label={summary} title={steps.map((s) => `${s.label}: ${s.state}`).join("\n")} className="inline-flex items-center gap-1">
      {steps.map((s) => {
        const c = STAGE_COLORS[s.key];
        const base = "inline-flex size-3 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none";
        let cls: string;
        if (s.state === "done") cls = `${c.solid}`;
        else if (s.state === "active") cls = `border-2 ${c.border} ring-2 ring-offset-1 ${c.ring} bg-transparent`;
        else if (s.state === "queued") cls = `border-2 border-dashed ${c.border} bg-transparent`;
        else if (s.state === "failed") cls = "bg-red-600 text-white";
        else if (s.state === "skipped") cls = "bg-gray-300 dark:bg-gray-600";
        else cls = "border border-gray-300 bg-transparent dark:border-gray-600";
        return (
          <span key={s.key} aria-hidden="true" className={`${base} ${cls}`}>
            {s.state === "failed" ? "!" : null}
          </span>
        );
      })}
    </span>
  );
}
