import type { Stage } from "@/lib/pipeline/run-article";

export const STAGE_LABEL: Record<Stage, string> = { convert: "Convert", analyze: "Analyze", enrich: "Enrich", rewrite: "Rewrite" };

/**
 * Ask the server to re-run a failed job item.
 * @param itemId the job item to restart
 * @param fromStage the stage to resume from
 * @return null on success, otherwise an error message to show the user
 */
export async function restartItem(itemId: string, fromStage: Stage): Promise<string | null> {
  try {
    const res = await fetch(`/api/job-items/${itemId}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromStage }),
    });
    if (res.status === 202) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? `Restart failed (HTTP ${res.status}).`;
  } catch {
    return "Could not reach the server. Try again.";
  }
}
