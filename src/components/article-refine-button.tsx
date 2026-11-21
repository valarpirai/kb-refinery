"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Primary button that starts a refine job for the given articles and opens the job page. */
export function ArticleRefineButton({ articleIds, label = "Refine this article" }: { articleIds: string[]; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articleIds }) });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not start the job");
      router.push(`/jobs/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={start} disabled={busy} className="art-press art-hover-solid rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Starting…" : label}
      </button>
      <span role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</span>
    </span>
  );
}
