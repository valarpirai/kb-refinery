"use client";

import Link from "next/link";
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessageData, ToolCall } from "@/app/(app)/chat/types";

/**
 * True while the agent is still working on this message.
 * @param m a chat message
 */
export const isAgentBusy = (m: ChatMessageData) => m.role === "assistant" && (m.status === "pending" || m.status === "streaming");

const TOOL_LABELS: Record<string, string> = {
  import_from_url: "Imported from a website",
  start_refine: "Started refining",
  get_job_status: "Checked job status",
  get_stats: "Looked up statistics",
  search_articles: "Searched articles",
};

const pretty = (v: unknown) => {
  if (v === undefined) return "(none)";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

function ToolRow({ call, fresh }: { call: ToolCall; fresh: boolean }) {
  const label = TOOL_LABELS[call.name] ?? call.name;
  return (
    <details className="chat-tool" data-fresh={fresh || undefined} data-status={call.status}>
      <summary>
        <span className="chat-tool-state" aria-hidden="true">
          {call.status === "running" ? <i className="chat-pulse" /> : call.status === "success" ? "✓" : "!"}
        </span>
        <span className="chat-tool-name">{label}</span>
        <span className="chat-meta">{call.status === "running" ? "Running…" : call.status === "success" ? "Done" : "Failed"}</span>
      </summary>
      <div className="chat-tool-body">
        <p className="chat-meta">Input</p>
        <pre>{pretty(call.input)}</pre>
        {call.status !== "running" && (
          <>
            <p className="chat-meta">Output</p>
            <pre>{pretty(call.output)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

/** The person's own question in the agent thread. */
export function ChatUserMessage({ msg, fresh }: { msg: ChatMessageData; fresh: boolean }) {
  return (
    <section id={`turn-${msg.id}`} className="chat-turn">
      <div className="chat-user-row">
        <p className="chat-bubble chat-enter" data-fresh={fresh || undefined} style={{ "--enter-delay": "0ms" } as React.CSSProperties}>{msg.content}</p>
      </div>
    </section>
  );
}

interface Props {
  msg: ChatMessageData;
  isAdmin: boolean;
  fresh: boolean;
  onChange: (next: ChatMessageData) => void;
  onRetry: (msgId: string) => void;
  retryDisabled: boolean;
}

/** The agent's reply: tool calls, then prose that grows as text streams in. Polls every second while working. */
export function ChatAgentMessage({ msg, isAdmin, fresh, onChange, onRetry, retryDisabled }: Props) {
  const busy = isAgentBusy(msg);
  const id = msg.id;
  const tools = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/messages/${id}`, { cache: "no-store" });
        if (res.ok) onChange((await res.json()) as ChatMessageData);
      } catch {
        /* keep the last good state and try again */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [id, busy, onChange]);

  const status = busy ? "Working…" : msg.status === "failed" ? "The agent failed." : "Answer ready.";

  return (
    <section className="chat-agent chat-enter" data-fresh={fresh || undefined} style={{ "--enter-delay": "60ms" } as React.CSSProperties} aria-label="Agent reply">
      {tools.length > 0 && (
        <div className="chat-tools">
          {tools.map((t) => <ToolRow key={t.id} call={t} fresh={fresh} />)}
        </div>
      )}

      {msg.content && <div className="chat-prose chat-agent-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div>}

      {busy && !msg.content && (
        <div className="chat-typing" role="status">
          <span className="sr-only">Writing the answer…</span>
          <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
        </div>
      )}

      {msg.status === "failed" && (
        <div className="chat-agent-failed">
          <p className="chat-failed">{msg.error ?? "The agent could not finish."}</p>
          <button type="button" className="chat-pill chat-press" disabled={retryDisabled} onClick={() => onRetry(msg.id)}>Try again</button>
        </div>
      )}

      {isAdmin && msg.traceId && (
        <p className="chat-trace"><Link href={`/traces/${msg.traceId}`}>View trace</Link></p>
      )}

      <p className="sr-only" role="status" aria-live="polite">{status}</p>
    </section>
  );
}
