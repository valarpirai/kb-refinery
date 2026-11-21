"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SCHEDULES = [
  { value: "", label: "Manual only" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "0 2 * * 1", label: "Weekly, Monday 02:00" },
];

const field = "w-full rounded border border-black/20 px-3 py-2 text-sm dark:border-white/20 dark:bg-transparent";

/** Form to add a data source. */
export function SourceForm() {
  const router = useRouter();
  const [type, setType] = useState<"rest_json" | "url_crawl">("rest_json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const config =
      type === "rest_json"
        ? { url: get("url"), itemsPath: get("itemsPath") || undefined, kind: get("kind"), authHeader: get("authHeader") || undefined }
        : { urls: get("urls").split(/\s+/).filter(Boolean), authHeader: get("authHeader") || undefined };
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: get("name"), type, config, cron: get("cron") }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Could not save");
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-medium">Add a source</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">Name</label>
          <input id="name" name="name" required maxLength={100} className={field} />
        </div>
        <div>
          <label htmlFor="type" className="mb-1 block text-sm font-medium">Type</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={field}>
            <option value="rest_json">REST / JSON endpoint</option>
            <option value="url_crawl">List of web pages</option>
          </select>
        </div>
      </div>

      {type === "rest_json" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="url" className="mb-1 block text-sm font-medium">URL</label>
            <input id="url" name="url" type="url" required placeholder="https://example.com/api/articles" className={field} />
          </div>
          <div>
            <label htmlFor="itemsPath" className="mb-1 block text-sm font-medium">Path to the list (optional)</label>
            <input id="itemsPath" name="itemsPath" placeholder="result" className={field} />
          </div>
          <div>
            <label htmlFor="kind" className="mb-1 block text-sm font-medium">Records are</label>
            <select id="kind" name="kind" className={field}>
              <option value="articles">KB articles</option>
              <option value="incidents">Incidents</option>
            </select>
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="urls" className="mb-1 block text-sm font-medium">Page URLs, one per line</label>
          <textarea id="urls" name="urls" required rows={4} className={field} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="authHeader" className="mb-1 block text-sm font-medium">Authorization header (optional)</label>
          <input id="authHeader" name="authHeader" type="password" autoComplete="off" placeholder="Bearer …" className={field} />
          <p className="mt-1 text-xs opacity-70">Saved as plain text in your local database.</p>
        </div>
        <div>
          <label htmlFor="cron" className="mb-1 block text-sm font-medium">Schedule</label>
          <input id="cron" name="cron" list="schedules" placeholder="Pick one or type a cron expression" className={field} />
          <datalist id="schedules">
            {SCHEDULES.map((s) => <option key={s.value || "manual"} value={s.value}>{s.label}</option>)}
          </datalist>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Add source"}</button>
        <p aria-live="polite" className="text-sm text-red-600">{error}</p>
      </div>
    </form>
  );
}
