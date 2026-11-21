"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StatusPill } from "@/components/status-pill";
import { refinedFirst } from "@/lib/chat/blind";

interface Source {
  n: number;
  articleId: string;
  analysisId: string | null;
  title: string;
  heading: string | null;
  score: number;
  excerpt: string;
}
interface Arm {
  id: string;
  variant: "original" | "refined";
  status: "pending" | "running" | "completed" | "failed";
  answer: string | null;
  sources: Source[];
  latencyMs: number | null;
  error: string | null;
  judge: { score: number; reasoning: string } | null;
}
export interface ComparisonData {
  id: string;
  query: string;
  verdict: "original" | "refined" | "tie" | "neither" | null;
  note: string | null;
  arms: Arm[];
}


const busy = (c: ComparisonData) => c.arms.some((a) => a.status === "pending" || a.status === "running");

/** Ask a question against original and refined content, then compare the two answers side by side. */
export function ChatCompare({ initial }: { initial: ComparisonData | null }) {
  const router = useRouter();
  const [cmp, setCmp] = useState<ComparisonData | null>(initial);
  const [query, setQuery] = useState(initial?.query ?? "");
  const [blind, setBlind] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [judging, setJudging] = useState(false);

  const cmpId = cmp?.id;
  const waiting = cmp ? busy(cmp) : false;
  const judged = cmp?.arms.every((a) => a.judge) ?? false;

  useEffect(() => {
    if (!cmpId || !(waiting || judging)) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/compare/${cmpId}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as ComparisonData;
        setCmp(next);
        if (next.arms.every((a) => a.judge)) setJudging(false);
      } catch {
        /* keep the last good state and try again */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [cmpId, waiting, judging]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAsking(true);
    setJudging(false);
    const res = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    const json = await res.json();
    setAsking(false);
    if (!res.ok) return setError(json.error ?? "Could not ask");
    const full = await fetch(`/api/compare/${json.id}`).then((r) => r.json());
    setCmp(full);
    router.replace(`/chat?c=${json.id}`, { scroll: false });
  }

  async function verdict(value: ComparisonData["verdict"]) {
    if (!cmp) return;
    const res = await fetch(`/api/compare/${cmp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict: value }) });
    if (res.ok) {
      setCmp(await res.json());
      router.refresh();
    }
  }

  async function autoJudge() {
    if (!cmp) return;
    setJudging(true);
    const res = await fetch(`/api/compare/${cmp.id}/judge`, { method: "POST" });
    if (!res.ok) {
      setJudging(false);
      setError((await res.json()).error ?? "Could not judge");
    }
  }

  const order = cmp ? (refinedFirst(cmp.id) ? (["refined", "original"] as const) : (["original", "refined"] as const)) : [];
  const revealed = !blind || cmp?.verdict != null;
  const name = (v: "original" | "refined") => (v === "original" ? "Original" : "Refined");
  const verdicts = cmp
    ? [
        { value: order[0], label: revealed ? `${name(order[0])} is better` : "A is better" },
        { value: order[1], label: revealed ? `${name(order[1])} is better` : "B is better" },
        { value: "tie" as const, label: "About the same" },
        { value: "neither" as const, label: "Neither is good" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <form onSubmit={ask} className="space-y-3">
        <label htmlFor="q" className="block text-sm font-medium">Ask a question</label>
        <textarea id="q" value={query} onChange={(e) => setQuery(e.target.value)} rows={2} maxLength={1000} required placeholder="How do I reset my VPN password?" className="w-full rounded border border-black/20 px-3 py-2 text-sm dark:border-white/20 dark:bg-transparent" />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={asking || waiting || query.trim().length < 3} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {asking || waiting ? "Working…" : "Ask both"}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
            Blind mode: hide which answer is which until you choose
          </label>
        </div>
        <p aria-live="polite" className="text-sm text-red-600">{error}</p>
      </form>

      {cmp && (
        <section aria-label="Answers" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {order.map((variant, i) => {
              const arm = cmp.arms.find((a) => a.variant === variant);
              if (!arm) return null;
              const title = revealed ? (variant === "original" ? "Original docs" : "Refined docs") : `Answer ${i === 0 ? "A" : "B"}`;
              return (
                <article key={arm.id} className="flex flex-col rounded-lg border border-black/10 p-4 dark:border-white/15" aria-labelledby={`h-${arm.id}`}>
                  <header className="mb-3 flex items-center justify-between gap-2">
                    <h2 id={`h-${arm.id}`} className="font-semibold">{title}</h2>
                    <span className="flex items-center gap-2 text-xs opacity-80">
                      {arm.latencyMs != null && `${(arm.latencyMs / 1000).toFixed(1)}s`}
                      <StatusPill status={arm.status === "running" ? "analyzing" : arm.status} />
                    </span>
                  </header>

                  {arm.status === "failed" ? (
                    <p className="text-sm text-red-600">{arm.error ?? "Failed"}</p>
                  ) : arm.answer ? (
                    <div className="space-y-2 text-sm [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal"><ReactMarkdown remarkPlugins={[remarkGfm]}>{arm.answer}</ReactMarkdown></div>
                  ) : (
                    <p className="text-sm opacity-70">Waiting for the model…</p>
                  )}

                  {arm.judge && (
                    <p className="mt-3 rounded bg-black/5 p-2 text-xs dark:bg-white/10">
                      <strong>Auto-judge: {arm.judge.score}/5.</strong> {arm.judge.reasoning}
                    </p>
                  )}

                  {arm.sources.length > 0 && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer font-medium">Sources used ({arm.sources.length})</summary>
                      <ol className="mt-2 space-y-2">
                        {arm.sources.map((s) => (
                          <li key={s.n} className="rounded border border-black/10 p-2 dark:border-white/15">
                            <span className="font-medium">[{s.n}] </span>
                            {s.analysisId ? <Link href={`/analysis/${s.analysisId}`} className="text-blue-700 underline dark:text-blue-300">{s.title}</Link> : s.title}
                            {s.heading && <span className="opacity-70"> › {s.heading}</span>}
                            <span className="ml-2 opacity-60">match {s.score.toFixed(2)}</span>
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words opacity-80">{s.excerpt}</pre>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </article>
              );
            })}
          </div>

          {!waiting && cmp.arms.every((a) => a.status === "completed") && (
            <div className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Which answer is better?</legend>
                <div className="flex flex-wrap gap-2">
                  {verdicts.map((v) => (
                    <button key={v.value} type="button" aria-pressed={cmp.verdict === v.value} onClick={() => verdict(cmp.verdict === v.value ? null : v.value)}
                      className={`rounded border px-3 py-1.5 text-sm ${cmp.verdict === v.value ? "border-blue-600 bg-blue-600 text-white" : "border-black/20 dark:border-white/20"}`}>
                      {v.label}
                    </button>
                  ))}
                </div>
                {blind && !cmp.verdict && <p className="mt-2 text-xs opacity-70">Blind mode: A and B are in a mixed order. Choose a verdict to see which is the original.</p>}
              </fieldset>
              <button type="button" onClick={autoJudge} disabled={judging || judged} className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20">
                {judging ? "Judging… (can take a minute)" : judged ? "Auto-judged" : "Auto-judge with the local model"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
