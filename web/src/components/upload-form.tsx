"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RunResult {
  label: string;
  status: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** Bulk upload form for articles or incidents (MD, HTML, TXT, CSV, JSON). */
export function UploadForm() {
  const router = useRouter();
  const [kind, setKind] = useState<"articles" | "incidents">("articles");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const body = new FormData();
    body.set("kind", kind);
    files.forEach((f) => body.append("files", f));
    try {
      const res = await fetch("/api/import", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Upload failed");
      else {
        setResult(json);
        setFiles([]);
        router.refresh();
      }
    } catch {
      setError("Upload failed. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  const accept = kind === "articles" ? ".md,.markdown,.html,.htm,.txt,.csv,.json" : ".csv,.json";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-black/10 p-5 dark:border-white/15">
      <fieldset className="flex gap-6">
        <legend className="mb-2 text-sm font-medium">What are you uploading?</legend>
        {(["articles", "incidents"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => {
                setKind(k);
                setFiles([]);
              }}
            />
            {k === "articles" ? "KB articles" : "Incidents"}
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor="files" className="mb-1 block text-sm font-medium">
          Files
        </label>
        <input
          id="files"
          type="file"
          multiple
          accept={accept}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-white dark:file:bg-white dark:file:text-black"
        />
        <p className="mt-1 text-xs opacity-70">
          {kind === "articles"
            ? "Markdown, HTML and text files become one article each. CSV and JSON files hold many; they need title and body columns."
            : "CSV or JSON with number and short_description columns. Optional: description, resolution, category, opened_at."}
        </p>
      </div>

      <button
        type="submit"
        disabled={busy || files.length === 0}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Uploading…" : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
      </button>

      <div aria-live="polite">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <div className="text-sm">
            <p>
              {result.label}: {result.created} created, {result.updated} updated, {result.skipped} unchanged
              {result.errors.length > 0 && `, ${result.errors.length} problem(s)`}.
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-red-600">
                {result.errors.slice(0, 10).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
