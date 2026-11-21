"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArticleStageDots, type DotStep } from "@/components/article-stage-dots";
import { ArticleTags, type TagItem } from "@/components/article-tags";
import { StatusPill } from "@/components/status-pill";
import { statusClass } from "@/lib/format";

export interface ArticleRow {
  id: string;
  title: string;
  knowledgeBase: string | null;
  stage: string | null;
  rawScore: number | null;
  rewrittenScore: number | null;
  openFindings: number;
  tags: TagItem[];
  updatedAt: string;
  steps: DotStep[];
}

/** The articles list as a table on wide screens and as cards on narrow ones, with row selection and a bulk "Refine" bar. */
export function ArticleTable({ rows }: { rows: ArticleRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allRef = useRef<HTMLInputElement>(null);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const some = selected.size > 0 && !allSelected;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function refine() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articleIds: [...selected] }) });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not start the job");
      router.push(`/jobs/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const lab = "text-xs opacity-70 md:hidden";
  const cell = "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 md:table-cell md:px-0 md:py-2 md:pr-4 md:align-top";

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" className={selected.size ? "sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950" : "sr-only"}>
        {selected.size > 0 && (
          <>
            <button type="button" onClick={refine} disabled={busy} className="art-press art-hover-solid rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Starting…" : `Refine selected (${selected.size})`}
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="art-hover art-press rounded border border-black/15 px-3 py-1.5 dark:border-white/20">Clear selection</button>
          </>
        )}
        <span role="alert" className="text-red-700 dark:text-red-300">{error}</span>
      </div>

      <label className="inline-flex items-center gap-2 text-sm">
        <input ref={allRef} type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
        Select all on this page
      </label>

      <table role="table" className="block w-full text-left text-sm md:table">
        <caption className="sr-only">Articles</caption>
        <thead role="rowgroup" className="hidden border-b border-black/10 md:table-header-group dark:border-white/15">
          <tr role="row">
            <th scope="col" className="w-8 py-2 pr-2"><span className="sr-only">Select</span></th>
            <th scope="col" className="pr-4">Title</th>
            <th scope="col" className="pr-4">Knowledge base</th>
            <th scope="col" className="pr-4">Stage</th>
            <th scope="col" className="pr-4">Score (raw → rewritten)</th>
            <th scope="col" className="pr-4">Open findings</th>
            <th scope="col" className="pr-4">Tags</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="block md:table-row-group">
          {rows.map((r) => (
            <tr key={r.id} role="row" className="mb-3 block rounded-lg border border-black/10 py-2 md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:border-black/5 md:py-0 dark:border-white/15 md:dark:border-white/10">
              <td role="cell" className={`${cell} md:w-8`}>
                <input type="checkbox" aria-label={`Select ${r.title}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              </td>
              <td role="cell" className={`${cell} font-medium`}>
                <Link href={`/articles/${r.id}`} className="art-root text-blue-700 hover:underline dark:text-blue-300">{r.title}</Link>
              </td>
              <td role="cell" className={cell}>
                <span className={lab}>Knowledge base:</span>
                {r.knowledgeBase ?? <span className="opacity-60">None</span>}
              </td>
              <td role="cell" className={cell}>
                <span className={lab}>Stage:</span>
                {r.stage ? <StatusPill status={r.stage} /> : <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusClass("pending")}`}>Not refined</span>}
                <ArticleStageDots steps={r.steps} />
              </td>
              <td role="cell" className={`${cell} tabular-nums`}>
                <span className={lab}>Score:</span>
                <span aria-label={`Raw ${r.rawScore ?? "none"}, rewritten ${r.rewrittenScore ?? "none"}`}>{r.rawScore ?? "–"} → {r.rewrittenScore ?? "–"}</span>
              </td>
              <td role="cell" className={`${cell} tabular-nums`}>
                <span className={lab}>Open findings:</span>
                {r.openFindings}
              </td>
              <td role="cell" className={`${cell} md:min-w-48`}>
                <ArticleTags articleId={r.id} initial={r.tags} refresh />
              </td>
              <td role="cell" className={`${cell} whitespace-nowrap`}>
                <span className={lab}>Updated:</span>
                <time dateTime={r.updatedAt} suppressHydrationWarning>{new Date(r.updatedAt).toLocaleString()}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
