"use client";

import { useEffect, useRef } from "react";

/** What the server sends: a table name and the job or article it touches. No row data. */
export interface LiveEvent {
  t: string;
  id?: string;
  job?: string;
  article?: string;
}

/** Called with a change, or with null when the stream (re)connects and the page should resync. */
type Handler = (e: LiveEvent | null) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;
let opened = false;

/** Open the shared stream on first use. EventSource reconnects on its own. */
function open() {
  if (source) return;
  source = new EventSource("/api/events");
  source.onopen = () => {
    // The first open is covered by the server-rendered data. Later ones follow a drop, so resync.
    if (opened) for (const h of handlers) h(null);
    opened = true;
  };
  source.onmessage = (m) => {
    let e: LiveEvent;
    try {
      e = JSON.parse(m.data) as LiveEvent;
    } catch {
      return;
    }
    for (const h of handlers) h(e);
  };
}

/** Close the stream when nobody is listening. */
function close() {
  if (handlers.size > 0 || !source) return;
  source.close();
  source = null;
  opened = false;
}

/**
 * Run a callback on live changes from the server. All callers in a tab share one connection.
 * @param handler gets a change, or null after a reconnect. Keep it cheap: debounce any fetch inside it.
 * @param active set false to stop listening, for example when there is nothing to follow
 */
export function useLive(handler: Handler, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const h: Handler = (e) => ref.current(e);
    handlers.add(h);
    open();
    return () => {
      handlers.delete(h);
      close();
    };
  }, [active]);
}
