"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Run now, enable or disable, and delete buttons for one source. */
export function SourceActions({ id, enabled, name }: { id: string; enabled: boolean; name: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);

  async function call(url: string, init: RequestInit, done: string) {
    const res = await fetch(url, init);
    setNote(res.ok ? done : "Failed");
    router.refresh();
  }
  const btn = "rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} onClick={() => call(`/api/sources/${id}/run`, { method: "POST" }, "Queued. The worker will pull it.")}>Run now</button>
      <button type="button" className={btn} onClick={() => call(`/api/sources/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) }, enabled ? "Paused" : "Resumed")}>
        {enabled ? "Pause" : "Resume"}
      </button>
      <button type="button" className={`${btn} text-red-700 dark:text-red-300`} aria-label={`Delete ${name}`} onClick={() => confirm(`Delete "${name}"? Imported articles stay.`) && call(`/api/sources/${id}`, { method: "DELETE" }, "Deleted")}>Delete</button>
      <span aria-live="polite" className="text-xs opacity-70">{note}</span>
    </div>
  );
}
