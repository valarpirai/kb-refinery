"use client";

import { useLayoutEffect, type RefObject } from "react";

const MAX_HEIGHT = 192; // 8 lines of 24px

interface Props {
  query: string;
  onQuery: (value: string) => void;
  onSend: () => void;
  /** True while a question is being sent or answered. */
  busy: boolean;
  error: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** The message box pinned to the bottom of the chat. Enter sends, Shift+Enter adds a line. */
export function ChatComposer({ query, onQuery, onSend, busy, error, inputRef }: Props) {
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
            placeholder="Ask about your articles, or ask me to import, refine or look something up…"
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />
          <div className="chat-box-row">
            <div className="chat-box-left" />
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
