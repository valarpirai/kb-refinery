"use client";

import { useLayoutEffect, type RefObject } from "react";
import type { AgentOption, ChatMode } from "@/app/(app)/chat/types";

const MAX_HEIGHT = 192; // 8 lines of 24px

interface Props {
  query: string;
  onQuery: (value: string) => void;
  onSend: () => void;
  /** True while a question is being sent or answered. */
  busy: boolean;
  mode: ChatMode;
  onMode: (mode: ChatMode) => void;
  agents: AgentOption[];
  agentSlug: string;
  onAgent: (slug: string) => void;
  /** True once the conversation has messages. The agent can no longer change. */
  agentLocked: boolean;
  blind: boolean;
  onBlind: (value: boolean) => void;
  error: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** The message box pinned to the bottom of the chat. Enter sends, Shift+Enter adds a line. */
export function ChatComposer({ query, onQuery, onSend, busy, mode, onMode, agents, agentSlug, onAgent, agentLocked, blind, onBlind, error, inputRef }: Props) {
  const canSend = !busy && query.trim().length >= 3;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [query, inputRef]);

  return (
    <div className="chat-composer">
      <div className="chat-col">
        <p role="alert" className="chat-error">{error}</p>
        <form
          className="chat-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) onSend();
          }}
        >
          <label htmlFor="chat-q" className="sr-only">Ask a question</label>
          <textarea
            id="chat-q"
            ref={inputRef}
            value={query}
            rows={1}
            maxLength={1000}
            placeholder={mode === "agent" ? "Ask the agent to import, refine or look something up…" : "Ask one question to compare original and refined docs…"}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />
          <div className="chat-box-row">
            <div className="chat-box-left">
              <div role="group" aria-label="Mode" className="chat-seg">
                {([["agent", "Agent"], ["compare", "Compare docs"]] as const).map(([m, label]) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>{label}</button>
                ))}
              </div>
              {mode === "agent" && agents.length > 0 && (
                <label className="chat-agent-pick" title={agentLocked ? "A conversation keeps its agent. Start a new chat to use another." : agents.find((a) => a.slug === agentSlug)?.description || undefined}>
                  <span className="sr-only">Agent</span>
                  <select value={agentSlug} onChange={(e) => onAgent(e.target.value)} disabled={agentLocked}>
                    {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                  </select>
                </label>
              )}
              {mode === "compare" && (
                <label className="chat-switch" title="Hide which answer is original until you choose a verdict">
                  <input type="checkbox" role="switch" checked={blind} onChange={(e) => onBlind(e.target.checked)} />
                  <span>Blind mode</span>
                </label>
              )}
            </div>
            <button type="submit" className="chat-send chat-press" disabled={!canSend} aria-label="Send question">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
