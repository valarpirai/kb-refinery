"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Row {
  id: string;
  title: string;
  knowledgeBase: string | null;
  analysis: { pipelineStage: string } | null;
}

/** Button that opens a dialog to pick articles and start a refine job. */
export function RefinePicker() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/articles?q=${encodeURIComponent(q)}`);
        if (res.ok) setRows(await res.json());
      } catch {
        // Keep the rows already shown when the search fails.
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function start(all: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? {} : { articleIds: [...picked] }),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error ?? "Could not start the job");
      router.push(`/jobs/${json.id}`);
    } catch {
      setError("Could not start the job");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
        Refine articles
      </button>
      <dialog ref={dialog} aria-labelledby="refine-title" className="m-auto w-full max-w-xl rounded-lg p-0 backdrop:bg-black/40">
        <div className="space-y-3 p-5 text-black dark:bg-neutral-900 dark:text-white">
          <h2 id="refine-title" className="text-lg font-semibold">Refine articles</h2>
          <label htmlFor="refine-search" className="sr-only">Search articles</label>
          <input id="refine-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" className="w-full rounded border border-black/20 px-3 py-2 text-sm dark:border-white/20 dark:bg-transparent" />
          <ul className="max-h-72 divide-y divide-black/10 overflow-auto rounded border border-black/10 dark:divide-white/10 dark:border-white/10">
            {rows.length === 0 && <li className="p-3 text-sm opacity-70">No articles found.</li>}
            {rows.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-start gap-3 p-3 text-sm">
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" />
                  <span>
                    {r.title}
                    <span className="block text-xs opacity-70">
                      {r.knowledgeBase ?? "No knowledge base"} · {r.analysis ? r.analysis.pipelineStage : "not analyzed"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p aria-live="polite" className="text-sm text-red-600">{error}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="rounded border border-black/20 px-3 py-2 text-sm dark:border-white/20">Cancel</button>
            <button type="button" disabled={busy} onClick={() => start(true)} className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-700 disabled:opacity-50 dark:text-blue-300">Refine all</button>
            <button type="button" disabled={busy || picked.size === 0} onClick={() => start(false)} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              Refine {picked.size || ""} selected
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
