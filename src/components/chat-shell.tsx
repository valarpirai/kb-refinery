"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat-composer";
import { ChatEmpty } from "@/components/chat-empty";
import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatTurn, isBusy } from "@/components/chat-turn";
import type { ComparisonData, ConversationData, ConversationItem, IndexStatus, Tally } from "@/app/(app)/chat/types";

interface Props {
  userName: string;
  initialConversations: ConversationItem[];
  initialActive: ConversationData | null;
  initialTally: Tally;
  index: IndexStatus;
}

/** Sidebar, conversation and composer. Server props seed the state; after mount the client owns it. */
export function ChatShell({ userName, initialConversations, initialActive, initialTally, index }: Props) {
  const router = useRouter();
  const activeId = useSearchParams().get("c");

  const [conversations, setConversations] = useState(initialConversations);
  const [active, setActive] = useState<ConversationData | null>(initialActive);
  const [tally, setTally] = useState(initialTally);
  const [query, setQuery] = useState("");
  const [blind, setBlind] = useState(true);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [prevActiveId, setPrevActiveId] = useState(activeId);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef(active);
  const scrollToRef = useRef<string | null>(null);
  const shownConv = useRef<string | null>(null);

  useEffect(() => {
    activeRef.current = active;
  });

  // The URL changed (link, back button, New chat): load that conversation, or clear.
  if (activeId !== prevActiveId) {
    setPrevActiveId(activeId);
    if (activeId !== active?.id) {
      setActive(null);
      setLoadingId(activeId);
    }
  }

  useEffect(() => {
    if (!loadingId) return;
    let live = true;
    fetch(`/api/conversations/${loadingId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ConversationData | null) => {
        if (!live) return;
        setActive(data);
        setLoadingId(null);
      })
      .catch(() => {
        if (live) setLoadingId(null);
      });
    return () => {
      live = false;
    };
  }, [loadingId]);

  // Scroll: smooth to a new question, instantly to the end of an opened conversation.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    const target = scrollToRef.current;
    if (target) {
      scrollToRef.current = null;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`turn-${target}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    } else if (shownConv.current !== active.id) {
      el.scrollTop = el.scrollHeight;
    }
    shownConv.current = active.id;
  }, [active]);

  const closeDrawer = useCallback(() => {
    setDrawer(false);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
        menuRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.querySelector<HTMLElement>("#chat-sidebar a")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (res.ok) setConversations((await res.json()) as ConversationItem[]);
    } catch {
      /* the list stays as it was */
    }
  }, []);

  const updateComparison = useCallback((next: ComparisonData) => {
    const prev = activeRef.current?.comparisons.find((c) => c.id === next.id);
    if (prev && prev.verdict !== next.verdict) {
      setTally((t) => {
        const n = { ...t };
        if (prev.verdict) n[prev.verdict]--;
        if (next.verdict) n[next.verdict]++;
        return n;
      });
    }
    setActive((a) => (a ? { ...a, comparisons: a.comparisons.map((c) => (c.id === next.id ? { ...c, ...next } : c)) } : a));
  }, []);

  const busy = asking || (active?.comparisons.some(isBusy) ?? false);

  async function ask() {
    const q = query.trim();
    if (q.length < 3 || busy) return;
    setError(null);
    setAsking(true);
    try {
      const res = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, conversationId: active?.id }) });
      const json = (await res.json()) as { id?: string; conversationId?: string; error?: string };
      if (!res.ok || !json.id || !json.conversationId) return setError(json.error ?? "Could not ask");
      const full = (await fetch(`/api/compare/${json.id}`, { cache: "no-store" }).then((r) => r.json())) as ComparisonData;
      const convId = json.conversationId;
      const next = { ...full, conversationId: convId };
      const isNew = activeRef.current?.id !== convId;
      setQuery("");
      setFresh((f) => new Set(f).add(next.id));
      scrollToRef.current = next.id;
      setActive((a) => (a && a.id === convId ? { ...a, comparisons: [...a.comparisons, next] } : { id: convId, title: q.slice(0, 80), comparisons: [next] }));
      if (isNew) router.replace(`/chat?c=${convId}`, { scroll: false });
      void refreshList();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setAsking(false);
    }
  }

  async function rename(id: string, title: string) {
    const before = conversations;
    setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
    setActive((a) => (a && a.id === id ? { ...a, title } : a));
    const res = await fetch(`/api/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => null);
    if (!res?.ok) {
      setConversations(before);
      setActive((a) => (a && a.id === id ? { ...a, title: before.find((c) => c.id === id)?.title ?? a.title } : a));
      setError("Could not rename the conversation.");
    }
  }

  async function remove(id: string) {
    const title = conversations.find((c) => c.id === id)?.title ?? "this conversation";
    if (!confirm(`Delete "${title}" and all its questions? This cannot be undone.`)) return;
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Could not delete the conversation.");
    setConversations((cs) => cs.filter((c) => c.id !== id));
    if (active?.id === id || activeId === id) {
      setActive(null);
      router.replace("/chat", { scroll: false });
    }
    void refreshList();
  }

  function pick(text: string) {
    setQuery(text);
    inputRef.current?.focus();
  }

  return (
    <div className="chat-root" data-drawer={drawer ? "open" : "closed"}>
      <div className="chat-backdrop" onClick={closeDrawer} aria-hidden="true" />
      <ChatSidebar
        conversations={conversations}
        activeId={active?.id ?? activeId}
        tally={tally}
        index={index}
        onNavigate={closeDrawer}
        onRename={rename}
        onDelete={remove}
      />

      <section className="chat-main" aria-label="Chat">
        <header className="chat-header">
          <button ref={menuRef} type="button" className="chat-menu chat-press" aria-label="Open conversations" aria-expanded={drawer} aria-controls="chat-sidebar" onClick={() => setDrawer(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <h1 className="chat-title">{active?.title ?? "New chat"}</h1>
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-col chat-turns">
            {loadingId ? (
              <p className="chat-loading" role="status">Loading conversation…</p>
            ) : active && active.comparisons.length > 0 ? (
              active.comparisons.map((c) => <ChatTurn key={c.id} cmp={c} blind={blind} fresh={fresh.has(c.id)} onChange={updateComparison} />)
            ) : (
              <ChatEmpty name={userName} onPick={pick} />
            )}
          </div>
        </div>

        <ChatComposer query={query} onQuery={setQuery} onSend={ask} busy={busy} blind={blind} onBlind={setBlind} error={error} inputRef={inputRef} />
      </section>
    </div>
  );
}
