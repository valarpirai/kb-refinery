"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TOOL_CATALOG } from "@/lib/agent/catalog";
import { buildSystemPrompt } from "@/lib/agent/prompt";

const field = "w-full rounded border border-black/20 px-3 py-2 text-sm dark:border-white/20 dark:bg-transparent";

export interface AgentData {
  slug: string;
  name: string;
  description: string;
  role: string;
  rules: string[];
  tools: string[];
  toolNotes: Record<string, string>;
}

/**
 * Edit one agent: name, description, role, rules, and the tools it may call with a note on each.
 * @param props.agent the saved values
 * @param props.canEdit false shows the same fields read-only, for people who are not admins
 */
export function AgentForm({ agent, canEdit }: { agent: AgentData; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [role, setRole] = useState(agent.role);
  const [rules, setRules] = useState(agent.rules.join("\n"));
  const [notes, setNotes] = useState(agent.toolNotes);
  const [tools, setTools] = useState(new Set(agent.tools));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The same builder the server uses on save, so this is exactly what will be stored.
  const preview = useMemo(
    () => buildSystemPrompt({ role, rules: rules.split("\n"), tools: [...tools], toolNotes: notes }),
    [role, rules, tools, notes],
  );

  function toggle(tool: string) {
    setSaved(false);
    setTools((t) => {
      const next = new Set(t);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/agents/${agent.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, role, rules: rules.split("\n").map((r) => r.trim()).filter(Boolean), tools: [...tools], toolNotes: Object.fromEntries([...tools].map((t) => [t, notes[t] ?? ""])) }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(json.error ?? `Could not save (HTTP ${res.status}).`);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const edited = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    fn(e.target.value);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Name</span>
        <input className={field} value={name} onChange={edited(setName)} disabled={!canEdit} maxLength={80} required />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Description</span>
        <textarea className={field} value={description} onChange={edited(setDescription)} disabled={!canEdit} rows={2} maxLength={500} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Role</span>
        <span className="block text-xs opacity-70">Who the agent is. This opens the prompt.</span>
        <textarea className={`${field} min-h-24`} value={role} onChange={edited(setRole)} disabled={!canEdit} maxLength={4000} required />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Rules</span>
        <span className="block text-xs opacity-70">One rule per line. They apply to every message.</span>
        <textarea className={`${field} min-h-40`} value={rules} onChange={edited(setRules)} disabled={!canEdit} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tools</legend>
        <span className="block text-xs opacity-70">Tick the tools the agent may call. A ticked tool is listed in the prompt, with its note. An unticked tool is never mentioned or offered.</span>
        <ul className="space-y-2">
          {TOOL_CATALOG.map((t) => (
            <li key={t.name} className="rounded border border-black/10 p-3 text-sm dark:border-white/15">
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-1 cursor-pointer" checked={tools.has(t.name)} onChange={() => toggle(t.name)} disabled={!canEdit} />
                <span>
                  <span className="block font-medium">{t.label} <code className="text-xs font-normal opacity-60">{t.name}</code></span>
                  <span className="block text-xs opacity-70">{t.summary}</span>
                </span>
              </label>
              {tools.has(t.name) && (
                <label className="mt-2 block space-y-1 pl-6">
                  <span className="text-xs font-medium">When to use it</span>
                  <textarea
                    className={`${field} min-h-16`}
                    value={notes[t.name] ?? ""}
                    onChange={(e) => { setSaved(false); setNotes((n) => ({ ...n, [t.name]: e.target.value })); }}
                    disabled={!canEdit}
                    maxLength={1500}
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <details className="rounded-lg border border-black/10 p-4 dark:border-white/15" open>
        <summary className="cursor-pointer text-sm font-medium">Prompt preview</summary>
        <p className="mt-2 text-xs opacity-70">Built from what is on this form, saved or not. Saving stores this text, and the agent runs it as is.</p>
        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10" tabIndex={0}>{preview}</pre>
        <p className="mt-2 text-right text-xs tabular-nums opacity-60">{preview.length.toLocaleString()} characters</p>
      </details>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="cursor-pointer rounded bg-black px-4 py-2 text-sm font-medium text-white transition-transform duration-100 active:scale-[0.97] disabled:opacity-50 dark:bg-white dark:text-black">
            {busy ? "Saving…" : "Save changes"}
          </button>
          <p role="status" aria-live="polite" className="text-sm">
            {saved ? "Saved. The next message uses it." : ""}
          </p>
          <p role="alert" className="text-sm text-red-600">{error}</p>
        </div>
      ) : (
        <p className="text-sm opacity-70">Only admins can edit agents.</p>
      )}
    </form>
  );
}
