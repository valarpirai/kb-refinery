"use client";

import { Popover } from "@base-ui/react/popover";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { useLive } from "@/lib/use-live";
import "./notification-center.css";

interface Item {
  id: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

const LEVEL_LABEL = { info: "Info", success: "Done", warning: "Heads up", error: "Problem" } as const;
const LEVEL_STYLE = {
  info: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  success: "bg-green-100 text-green-900 dark:bg-green-900/50 dark:text-green-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  error: "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-200",
} as const;

/** Bell with an unread count, a list of recent notifications, and a toast for each new one. */
export function NotificationCenter() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: Item[] };
      setItems(data.items);
      setUnread(data.unread);
      // The first load only records what is already there. Later loads toast what is new.
      if (seen.current === null) {
        seen.current = new Set(data.items.map((i) => i.id));
        return;
      }
      for (const n of [...data.items].reverse()) {
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        const show = n.level === "error" ? toast.error : n.level === "success" ? toast.success : n.level === "warning" ? toast.warning : toast;
        show(n.title, { description: n.body ?? undefined, action: n.href ? { label: "Open", onClick: () => router.push(n.href as string) } : undefined });
      }
    } catch {
      /* keep what we have and try again */
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server says when one of this user's notifications changes. A reconnect (null) resyncs.
  useLive((e) => {
    if (e === null || e.t === "Notification") void load();
  });

  async function markRead(ids?: string[]) {
    await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { ids } : {}) });
    await load();
  }

  async function openItem(n: Item) {
    setOpen(false);
    if (!n.readAt) void markRead([n.id]);
    if (n.href) router.push(n.href);
  }

  return (
    <>
      <Toaster position="bottom-right" closeButton />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className="notif-bell relative rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          Notifications
          {unread > 0 && (
            <span className="ml-1.5 inline-block min-w-5 rounded-full bg-blue-600 px-1.5 text-center text-[0.65rem] font-semibold leading-5 text-white" aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner className="notif-positioner" side="bottom" align="end" sideOffset={8}>
            <Popover.Popup className="notif-popup w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border border-black/10 bg-white text-black shadow-lg dark:border-white/15 dark:bg-neutral-900 dark:text-white">
              <div className="flex items-center justify-between border-b border-black/10 px-3 py-2 dark:border-white/15">
                <Popover.Title className="text-sm font-semibold">Notifications</Popover.Title>
                <button type="button" disabled={unread === 0} onClick={() => markRead()} className="text-xs underline disabled:opacity-40">Mark all read</button>
              </div>
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm opacity-70">Nothing yet. You will hear about finished jobs, pulls and problems here.</p>
              ) : (
                <ul className="max-h-96 divide-y divide-black/10 overflow-auto dark:divide-white/15">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => openItem(n)} className={`block w-full px-3 py-2 text-left text-sm ${n.readAt ? "opacity-70" : ""}`}>
                        <span className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${LEVEL_STYLE[n.level]}`}>{LEVEL_LABEL[n.level]}</span>
                          <span className="font-medium">{n.title}</span>
                          {!n.readAt && <span className="ml-auto text-[0.65rem] font-semibold text-blue-700 dark:text-blue-300">New</span>}
                        </span>
                        {n.body && <span className="mt-1 block text-xs opacity-80">{n.body}</span>}
                        <span className="mt-1 block text-[0.65rem] opacity-60">{new Date(n.createdAt).toLocaleString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
