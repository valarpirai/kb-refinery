"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { refinedFirst } from "@/lib/chat/blind";
import type { Arm, ComparisonData, Verdict } from "@/app/(app)/chat/types";

/**
 * True while either answer is still being produced.
 * @param c the comparison
 */
export const isBusy = (c: ComparisonData) => c.arms.some((a) => a.status === "pending" || a.status === "running");

const name = (v: "original" | "refined") => (v === "original" ? "Original" : "Refined");

/** Three dots shown while an answer is being written. */
function Typing() {
  return (
    <div className="chat-typing" role="status">
      <span className="sr-only">Writing the answer…</span>
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </div>
  );
}

function AnswerCard({ arm, title, fresh, delay }: { arm: Arm; title: string; fresh: boolean; delay: number }) {
  const waiting = arm.status === "pending" || arm.status === "running";
  return (
    <article
      className="chat-card chat-enter"
      data-fresh={fresh || undefined}
      style={{ "--enter-delay": `${delay}ms` } as React.CSSProperties}
      aria-labelledby={`h-${arm.id}`}
    >
      <header className="chat-card-head">
        <h3 id={`h-${arm.id}`}>{title}</h3>
        {arm.latencyMs != null && <span className="chat-meta">{(arm.latencyMs / 1000).toFixed(1)}s</span>}
      </header>

      {arm.status === "failed" ? (
        <p className="chat-failed">{arm.error ?? "This answer failed."}</p>
      ) : arm.answer ? (
        <div className="chat-prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{arm.answer}</ReactMarkdown></div>
      ) : waiting ? (
        <Typing />
      ) : null}

      {arm.judge && (
        <p className="chat-judge"><strong>Auto-judge: {arm.judge.score}/5.</strong> {arm.judge.reasoning}</p>
      )}

      {arm.sources.length > 0 && (
        <details className="chat-sources">
          <summary>Sources used ({arm.sources.length})</summary>
          <ol>
            {arm.sources.map((s) => (
              <li key={s.n}>
                <span className="chat-src-n">[{s.n}]</span>{" "}
                {s.analysisId ? <Link href={`/analysis/${s.analysisId}`}>{s.title}</Link> : s.title}
                {s.heading && <span className="chat-meta"> › {s.heading}</span>}
                <span className="chat-meta"> · match {s.score.toFixed(2)}</span>
                <pre>{s.excerpt}</pre>
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}

interface Props {
  cmp: ComparisonData;
  blind: boolean;
  fresh: boolean;
  onChange: (next: ComparisonData) => void;
}

/**
 * One question and its two answers, with verdict, auto-judge and sources.
 * Polls its own comparison every 2 seconds while an answer or judge is pending.
 */
export function ChatTurn({ cmp, blind, fresh, onChange }: Props) {
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting = isBusy(cmp);
  const judged = cmp.arms.every((a) => a.judge);
  const cmpId = cmp.id;

  useEffect(() => {
    if (!waiting && !judging) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/compare/${cmpId}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as ComparisonData;
        onChange(next);
        if (next.arms.every((a) => a.judge)) setJudging(false);
      } catch {
        /* keep the last good state and try again */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [cmpId, waiting, judging, onChange]);

  async function verdict(value: Verdict | null) {
    const res = await fetch(`/api/compare/${cmp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict: value }) });
    if (res.ok) onChange((await res.json()) as ComparisonData);
  }

  async function autoJudge() {
    setError(null);
    setJudging(true);
    const res = await fetch(`/api/compare/${cmp.id}/judge`, { method: "POST" });
    if (!res.ok) {
      setJudging(false);
      setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not judge");
    }
  }

  const order = refinedFirst(cmp.id) ? (["refined", "original"] as const) : (["original", "refined"] as const);
  const revealed = !blind || cmp.verdict != null;
  const done = !waiting && cmp.arms.every((a) => a.status === "completed");
  const verdicts = [
    { value: order[0] as Verdict, label: revealed ? `${name(order[0])} is better` : "A is better" },
    { value: order[1] as Verdict, label: revealed ? `${name(order[1])} is better` : "B is better" },
    { value: "tie" as Verdict, label: "About the same" },
    { value: "neither" as Verdict, label: "Neither is good" },
  ];
  const status = waiting ? "Answering…" : done ? "Both answers are ready." : "One or more answers failed.";

  return (
    <section id={`turn-${cmp.id}`} className="chat-turn" aria-label={`Question: ${cmp.query}`}>
      <div className="chat-user-row">
        <p className="chat-bubble chat-enter" data-fresh={fresh || undefined} style={{ "--enter-delay": "0ms" } as React.CSSProperties}>{cmp.query}</p>
      </div>

      <div className="chat-answers">
        {order.map((variant, i) => {
          const arm = cmp.arms.find((a) => a.variant === variant);
          if (!arm) return null;
          const title = revealed ? `${name(variant)} docs` : `Answer ${i === 0 ? "A" : "B"}`;
          return <AnswerCard key={arm.id} arm={arm} title={title} fresh={fresh} delay={60 * (i + 1)} />;
        })}
      </div>

      {done && (
        <div className="chat-verdict">
          <fieldset>
            <legend>Which answer is better?</legend>
            <div className="chat-verdict-row">
              {verdicts.map((v) => (
                <button key={v.value} type="button" className="chat-pill chat-press" aria-pressed={cmp.verdict === v.value} onClick={() => verdict(cmp.verdict === v.value ? null : v.value)}>
                  {v.label}
                </button>
              ))}
            </div>
            {blind && !cmp.verdict && <p className="chat-hint">Blind mode: A and B are in a mixed order. Choose a verdict to see which is the original.</p>}
          </fieldset>
          <button type="button" className="chat-pill chat-press" onClick={autoJudge} disabled={judging || judged}>
            {judging ? "Judging… (can take a minute)" : judged ? "Auto-judged" : "Auto-judge with the local model"}
          </button>
          <p role="alert" className="chat-error">{error}</p>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">{status}</p>
    </section>
  );
}
