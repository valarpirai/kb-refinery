/** One tool an agent may be given. The label and summary are for people. The model reads its own description in tools.ts. */
export interface ToolInfo {
  name: string;
  label: string;
  summary: string;
}

/** Every tool the worker can build. An agent lists the names it is allowed to call. */
export const TOOL_CATALOG: ToolInfo[] = [
  { name: "import_from_url", label: "Import from a website", summary: "Fetches a page and the pages it links to on the same site, and imports them as articles." },
  { name: "start_refine", label: "Start refining", summary: "Starts a refine job for an import or for article ids. Returns at once." },
  { name: "restart_failed", label: "Restart failed articles", summary: "Queues articles whose latest run failed, from the stage that failed." },
  { name: "get_job_status", label: "Check a job", summary: "Reports a job's status and the count per stage." },
  { name: "get_stats", label: "Look up statistics", summary: "Reports article counts, stages, failed articles, open findings, average scores and top products." },
  { name: "search_articles", label: "Search articles", summary: "Finds articles by title words." },
  { name: "search_knowledge", label: "Answer from articles", summary: "Searches the refined article text and returns excerpts that answer a question." },
];

export const TOOL_NAMES = TOOL_CATALOG.map((t) => t.name);
