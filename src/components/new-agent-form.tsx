"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const field = "w-full rounded border border-black/20 px-3 py-2 text-sm dark:border-white/20 dark:bg-transparent";

/**
 * A form that creates an agent, then opens it so you can set its tools and rules.
 * @param props.agents existing agents, offered as something to copy rules and tools from
 */
export function NewAgentForm({ agents }: { agents: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: get("name"), description: get("description"), role: get("role"), copyFrom: get("copyFrom") || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (!res.ok || !json.slug) return setError(json.error ?? `Could not create it (HTTP ${res.status}).`);
      router.push(`/agents/${json.slug}`);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="cursor-pointer rounded bg-black px-4 py-2 text-sm font-medium text-white transition-transform duration-100 active:scale-[0.97] dark:bg-white dark:text-black">
        New agent
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <h2 className="font-semibold">New agent</h2>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Name</span>
        <input name="name" className={field} maxLength={80} required autoFocus />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Description</span>
        <input name="description" className={field} maxLength={500} placeholder="What it is for. Shown in the list." />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Role</span>
        <textarea name="role" className={`${field} min-h-24`} maxLength={4000} required placeholder="You are an analyst. You answer questions about the knowledge base from its statistics." />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Start from</span>
        <select name="copyFrom" className={field} defaultValue="">
          <option value="">Nothing. No tools and no rules.</option>
          {agents.map((a) => <option key={a.slug} value={a.slug}>Copy the rules and tools of {a.name}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="cursor-pointer rounded bg-black px-4 py-2 text-sm font-medium text-white transition-transform duration-100 active:scale-[0.97] disabled:opacity-50 dark:bg-white dark:text-black">
          {busy ? "Creating…" : "Create and open"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="cursor-pointer text-sm hover:underline">Cancel</button>
        <p role="alert" className="text-sm text-red-600">{error}</p>
      </div>
    </form>
  );
}
