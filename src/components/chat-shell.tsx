"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatAgentMessage, ChatUserMessage, isAgentBusy } from "@/components/chat-agent";
import { ChatComposer } from "@/components/chat-composer";
import { ChatEmpty } from "@/components/chat-empty";
import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatTurn, isBusy } from "@/components/chat-turn";
import { AUTO_AGENT_SLUG } from "@/lib/agent/slugs";
import type { ChatMessageData, ComparisonData, ConversationData, ConversationItem, IndexStatus, Tally } from "@/app/(app)/chat/types";

interface Props {
  userName: string;
  isAdmin: boolean;
  initialConversations: ConversationItem[];
}

/** Sidebar, conversation and composer. Server props seed the state; after mount the client owns it. */
export function ChatShell({ userName, isAdmin, initialConversations }: Props) {
  const router = useRouter();
  const activeId = useSearchParams().get("c");

  const [conversations, setConversations] = useState(initialConversations);
  const [active, setActive] = useState<ConversationData | null>(null);
  const [tally, setTally] = useState<Tally>({ original: 0, refined: 0, tie: 0, neither: 0 })
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(activeId);
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

  // Index progress and verdict totals load after first paint.
  useEffect(() => {
    let live = true;
    fetch("/api/chat/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { tally: Tally; index: IndexStatus } | null) => {
        if (!live || !data) return;
        setTally(data.tally);
        setIndex(data.index);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

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

  const updateMessage = useCallback((next: ChatMessageData) => {
    // Keep createdAt. A sent message gets a browser timestamp, and the server's earlier one would sort the reply above the question.
    setActive((a) => (a ? { ...a, messages: a.messages.map((m) => (m.id === next.id ? { ...m, ...next, createdAt: m.createdAt } : m)) } : a));
  }, []);

  const thread: ({ kind: "compare"; cmp: ComparisonData } | { kind: "message"; msg: ChatMessageData })[] = (active
    ? [
        ...active.comparisons.map((cmp) => ({ at: cmp.createdAt, item: { kind: "compare" as const, cmp } })),
        ...(active.messages ?? []).map((msg) => ({ at: msg.createdAt, item: { kind: "message" as const, msg } })),
      ].sort((x, y) => x.at.localeCompare(y.at))
    : []
  ).map((x) => x.item);

  const busy = asking || (active?.messages.some(isAgentBusy) ?? false) || (active?.comparisons.some(isBusy) ?? false);

  async function sendAgent(text: string) {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setError(null);
    setAsking(true);
    try {
      const res = await fetch("/api/agent/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q, conversationId: active?.id, agentSlug: AUTO_AGENT_SLUG }) });
      const json = (await res.json()) as { conversationId?: string; userMessageId?: string; assistantMessageId?: string; error?: string };
      if (!res.ok || !json.conversationId || !json.userMessageId || !json.assistantMessageId) return setError(json.error ?? "Could not send");
      const convId = json.conversationId;
      const now = new Date().toISOString();
      const base = { conversationId: convId, toolCalls: [], error: null, traceId: null, createdAt: now };
      const userMsg: ChatMessageData = { ...base, id: json.userMessageId, role: "user", content: q, status: "completed" };
      const botMsg: ChatMessageData = { ...base, id: json.assistantMessageId, role: "assistant", content: "", status: "pending", createdAt: new Date(Date.now() + 1).toISOString() };
      const isNew = activeRef.current?.id !== convId;
      setQuery("");
      setFresh((f) => new Set(f).add(userMsg.id).add(botMsg.id));
      scrollToRef.current = userMsg.id;
      setActive((a) => (a && a.id === convId ? { ...a, messages: [...a.messages, userMsg, botMsg] } : { id: convId, title: q.slice(0, 80), agentSlug: AUTO_AGENT_SLUG, comparisons: [], messages: [userMsg, botMsg] }));
      if (isNew) router.replace(`/chat?c=${convId}`, { scroll: false });
      void refreshList();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setAsking(false);
    }
  }

  function retry(msgId: string) {
    const msgs = active?.messages ?? [];
    const i = msgs.findIndex((m) => m.id === msgId);
    const user = msgs.slice(0, Math.max(i, 0)).reverse().find((m) => m.role === "user");
    if (user) void sendAgent(user.content);
  }

  function ask() {
    void sendAgent(query);
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
            ) : thread.length > 0 ? (
              thread.map((t) =>
                t.kind === "compare" ? (
                  <ChatTurn key={t.cmp.id} cmp={t.cmp} blind={false} fresh={fresh.has(t.cmp.id)} onChange={updateComparison} />
                ) : t.msg.role === "user" ? (
                  <ChatUserMessage key={t.msg.id} msg={t.msg} fresh={fresh.has(t.msg.id)} />
                ) : (
                  <ChatAgentMessage key={t.msg.id} msg={t.msg} isAdmin={isAdmin} fresh={fresh.has(t.msg.id)} onChange={updateMessage} onRetry={retry} retryDisabled={busy} />
                ),
              )
            ) : (
              <ChatEmpty name={userName} onPick={pick} />
            )}
          </div>
        </div>

        <ChatComposer query={query} onQuery={setQuery} onSend={ask} busy={busy} error={error} inputRef={inputRef} />
      </section>
    </div>
  );
}
