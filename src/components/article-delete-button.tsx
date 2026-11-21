"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import "./article-delete-button.css";

interface Props {
  articleIds: string[];
  /** Name shown in the question when deleting one article. */
  title?: string;
  /** Where to go after deleting. Without it the page refreshes. */
  redirectTo?: string;
  label?: string;
  onDone?: () => void;
}

/** A Delete button that asks first, then removes the articles and everything under them. */
export function ArticleDeleteButton({ articleIds, title, redirectTo, label = "Delete", onDone }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const many = articleIds.length > 1;

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/articles/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: articleIds }) });
      const data = (await res.json().catch(() => ({}))) as { deleted?: number; busy?: { title: string }[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not delete");
      if (data.busy?.length) {
        const names = data.busy.slice(0, 3).map((b) => b.title).join(", ");
        throw new Error(`${data.deleted ?? 0} deleted. ${data.busy.length} still being processed and kept: ${names}. Try those again when they finish.`);
      }
      setOpen(false);
      onDone?.();
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
      if (/deleted\./.test((e as Error).message)) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(""); }}>
      <AlertDialog.Trigger className="art-press rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950">
        {label}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="del-backdrop fixed inset-0 z-40 bg-black/40" />
        <AlertDialog.Popup className="del-popup fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-black/10 bg-white p-5 text-black shadow-xl dark:border-white/15 dark:bg-neutral-900 dark:text-white">
          <AlertDialog.Title className="text-base font-semibold">
            {many ? `Delete ${articleIds.length} articles?` : title ? `Delete “${title}”?` : "Delete this article?"}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm opacity-80">
            This removes {many ? "them" : "it"} with the analysis, findings, refined versions and chat search data. It cannot be undone. A source pull may bring {many ? "them" : "it"} back.
          </AlertDialog.Description>
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Close className="art-press rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20">Cancel</AlertDialog.Close>
            <button type="button" onClick={remove} disabled={busy} className="art-press rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
