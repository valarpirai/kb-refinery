/**
 * Turn a raw span name into words a person can read.
 * @param name the span name as stored
 * @return a short label
 */
export function spanLabel(name: string): string {
  if (name.startsWith("invoke_agent")) return "Agent run";
  if (name === "execute_agent_loop_cycle") return "Agent loop cycle";
  if (name === "chat" || name.startsWith("chat ")) return "Model call";
  if (name.startsWith("execute_tool ")) return `Tool: ${name.slice("execute_tool ".length)}`;
  if (name === "kb_refinery.agent_chat") return "Chat request";
  if (name.startsWith("process ")) return `Worker: ${name.slice(8)}`;
  if (name.startsWith("send ")) return `Queued: ${name.slice(5)}`;
  if (name.startsWith("complete ")) return `Completed: ${name.slice(9)}`;
  return name;
}

/**
 * Format milliseconds as a short duration.
 * @param ms milliseconds
 * @return text such as 850 ms, 12.4 s or 3 min 5 s
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Tool names in the filter and list, from `execute_tool <name>` spans. */
export const TOOL_PREFIX = "execute_tool ";
