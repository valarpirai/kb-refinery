"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Queue a rebuild of the chat search index. The worker does the work. */
export function ReindexButton() {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  async function go() {
    try {
      const res = await fetch("/api/chat/index", { method: "POST" });
      setNote(res.ok ? "Queued. Refresh in a moment." : "Failed");
    } catch {
      setNote("Failed");
    }
    setTimeout(() => router.refresh(), 4000);
  }
  return (
    <span className="flex items-center gap-2">
      <button type="button" onClick={go} className="rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20">Rebuild index</button>
      <span aria-live="polite" className="text-xs opacity-70">{note}</span>
    </span>
  );
}
