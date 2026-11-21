/**
 * Shared color sets. Every class is written out in full so Tailwind can see it.
 * Color marks a category. State (done, active, failed) is shown with text and icons too.
 */

export interface ColorSet {
  /** Solid fill, for dots and bars. */
  solid: string;
  /** Soft tint with readable text, for badges and chips. */
  soft: string;
  /** Border color. */
  border: string;
  /** Text color on the page background. */
  text: string;
  /** Ring color for focus or the active step. */
  ring: string;
}

const set = (c: ColorSet) => c;

const slate = set({ solid: "bg-slate-500", soft: "bg-slate-100 text-slate-800 dark:bg-slate-800/70 dark:text-slate-200", border: "border-slate-400", text: "text-slate-700 dark:text-slate-300", ring: "ring-slate-400" });
const sky = set({ solid: "bg-sky-500", soft: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-200", border: "border-sky-500", text: "text-sky-700 dark:text-sky-300", ring: "ring-sky-500" });
const violet = set({ solid: "bg-violet-500", soft: "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-200", border: "border-violet-500", text: "text-violet-700 dark:text-violet-300", ring: "ring-violet-500" });
const amber = set({ solid: "bg-amber-500", soft: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200", border: "border-amber-500", text: "text-amber-700 dark:text-amber-300", ring: "ring-amber-500" });
const pink = set({ solid: "bg-pink-500", soft: "bg-pink-100 text-pink-900 dark:bg-pink-900/50 dark:text-pink-200", border: "border-pink-500", text: "text-pink-700 dark:text-pink-300", ring: "ring-pink-500" });
const emerald = set({ solid: "bg-emerald-500", soft: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200", border: "border-emerald-500", text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500" });
const indigo = set({ solid: "bg-indigo-500", soft: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-200", border: "border-indigo-500", text: "text-indigo-700 dark:text-indigo-300", ring: "ring-indigo-500" });
const blue = set({ solid: "bg-blue-500", soft: "bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-200", border: "border-blue-500", text: "text-blue-700 dark:text-blue-300", ring: "ring-blue-500" });
const orange = set({ solid: "bg-orange-500", soft: "bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200", border: "border-orange-500", text: "text-orange-700 dark:text-orange-300", ring: "ring-orange-500" });
const teal = set({ solid: "bg-teal-500", soft: "bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-200", border: "border-teal-500", text: "text-teal-700 dark:text-teal-300", ring: "ring-teal-500" });
const gray = set({ solid: "bg-gray-400", soft: "bg-gray-100 text-gray-800 dark:bg-gray-800/70 dark:text-gray-200", border: "border-gray-400", text: "text-gray-700 dark:text-gray-300", ring: "ring-gray-400" });

/** One color per pipeline step. Used by the pipeline view. */
export const STAGE_COLORS = { import: slate, convert: sky, analyze: violet, enrich: amber, rewrite: pink, ready: emerald } as const;

export type SpanKind = "agent" | "loop" | "model" | "tool" | "request" | "queue" | "other";

/** One color per kind of trace span. Used by the Traces pages. */
export const SPAN_KIND: Record<SpanKind, { label: string; colors: ColorSet }> = {
  agent: { label: "Agent run", colors: violet },
  loop: { label: "Loop cycle", colors: indigo },
  model: { label: "Model call", colors: blue },
  tool: { label: "Tool call", colors: orange },
  request: { label: "Chat request", colors: teal },
  queue: { label: "Worker / queue", colors: slate },
  other: { label: "Other", colors: gray },
};

/**
 * Work out what kind of span a name belongs to.
 * @param name the stored span name
 * @return the span kind
 */
export function spanKind(name: string): SpanKind {
  if (name.startsWith("invoke_agent")) return "agent";
  if (name === "execute_agent_loop_cycle") return "loop";
  if (name.startsWith("chat ") || name === "chat") return "model";
  if (name.startsWith("execute_tool ")) return "tool";
  if (name === "kb_refinery.agent_chat") return "request";
  if (/^(process|send|complete) /.test(name)) return "queue";
  return "other";
}
