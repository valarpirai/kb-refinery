"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ReindexButton } from "@/components/reindex-button";
import type { ConversationItem, IndexStatus, Tally } from "@/app/(app)/chat/types";

const DAY = 86_400_000;

/**
 * Bucket conversations by how recently they were updated.
 * @param items conversations, newest first
 * @return non-empty groups in display order
 */
function group(items: ConversationItem[]): { label: string; items: ConversationItem[] }[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const buckets = [
    { label: "Today", items: [] as ConversationItem[] },
    { label: "Yesterday", items: [] as ConversationItem[] },
    { label: "Previous 7 days", items: [] as ConversationItem[] },
    { label: "Older", items: [] as ConversationItem[] },
  ];
  for (const c of items) {
    const t = new Date(c.updatedAt).getTime();
    const i = t >= today ? 0 : t >= today - DAY ? 1 : t >= today - 7 * DAY ? 2 : 3;
    buckets[i].items.push(c);
  }
  return buckets.filter((b) => b.items.length > 0);
}

const Icon = ({ d }: { d: string }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

interface Props {
  conversations: ConversationItem[];
  activeId: string | null;
  tally: Tally;
  index: IndexStatus;
  onNavigate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

/** Conversation list, with rename and delete, plus index status and verdict totals. */
export function ChatSidebar({ conversations, activeId, tally, index, onNavigate, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  function startEdit(c: ConversationItem) {
    cancelled.current = false;
    setDraft(c.title);
    setEditing(c.id);
  }
  function commit(c: ConversationItem) {
    setEditing(null);
    const next = draft.trim();
    if (!cancelled.current && next && next !== c.title) onRename(c.id, next);
  }

  const rated = tally.refined + tally.original + tally.tie + tally.neither;

  return (
    <aside id="chat-sidebar" className="chat-sidebar" aria-label="Conversations">
      <div className="chat-side-top">
        <Link href="/chat" className="chat-new chat-press" onClick={onNavigate}>
          <Icon d="M12 5v14M5 12h14" />
          New chat
        </Link>
      </div>

      <nav className="chat-list" aria-label="Your conversations">
        {conversations.length === 0 && <p className="chat-side-empty">No conversations yet.</p>}
        {group(conversations).map((g) => (
          <section key={g.label}>
            <h2 suppressHydrationWarning>{g.label}</h2>
            <ul>
              {g.items.map((c) => (
                <li key={c.id} className="chat-row" data-active={c.id === activeId || undefined}>
                  {editing === c.id ? (
                    <input
                      className="chat-rename"
                      aria-label="Conversation title"
                      value={draft}
                      maxLength={120}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          cancelled.current = true;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <>
                      <Link href={`/chat?c=${c.id}`} prefetch={false} onClick={onNavigate} aria-current={c.id === activeId ? "page" : undefined} className="chat-row-link">
                        <span>{c.title}</span>
                      </Link>
                      <span className="chat-row-actions">
                        <button type="button" onClick={() => startEdit(c)} aria-label={`Rename ${c.title}`}><Icon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></button>
                        <button type="button" onClick={() => onDelete(c.id)} aria-label={`Delete ${c.title}`}><Icon d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <div className="chat-side-foot">
        <p>{index.indexed} of {index.total} refined articles indexed</p>
        <ReindexButton />
        <dl aria-label="Your verdicts" className="chat-tally">
          {([["Refined better", tally.refined], ["Original better", tally.original], ["Same", tally.tie], ["Neither", tally.neither]] as const).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {rated === 0 && <p className="chat-meta">No verdicts yet.</p>}
      </div>
    </aside>
  );
}
