/**
 * Turn an enum value like completed_with_errors into readable text.
 * @param value enum string
 * @return text with spaces and a leading capital
 */
export function label(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Tailwind classes for a status pill, by status name. */
export function statusClass(status: string): string {
  if (["completed", "ready"].includes(status)) return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
  if (["failed"].includes(status)) return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  if (["completed_with_errors", "skipped"].includes(status)) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  if (["pending", "ingested"].includes(status)) return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
}

/** Tailwind classes for a severity pill. */
export function severityClass(severity: string | null | undefined): string {
  if (severity === "high") return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  if (severity === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

/**
 * Show a byte count as a short size.
 * @param bytes size in bytes, or null when unknown
 * @return text such as 840 B, 11.5 KB or 2.1 MB, or a dash when unknown
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Show a duration as short text.
 * @param ms length in milliseconds
 * @return text such as 850 ms, 12.4 s or 5 min 53 s
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}
