import { subscribe, type ChangeEvent } from "@/lib/events";
import { getUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MERGE_MS = 250;
const PING_MS = 25_000;

/**
 * GET: a server-sent event stream of "something changed" signals.
 * Each message names a table and the job, article or user it touches. It carries no row data,
 * so the page refetches through its normal endpoint, which checks access again.
 * Notification changes reach only the user they belong to.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return unauthorized();

  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pending = new Map<string, ChangeEvent>();
      let timer: ReturnType<typeof setTimeout> | null = null;

      const send = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          cleanup();
        }
      };

      /** Send each distinct change once per window, so a burst of writes becomes one message. */
      const flush = () => {
        timer = null;
        for (const e of pending.values()) send(`data: ${JSON.stringify(e)}\n\n`);
        pending.clear();
      };

      const unsubscribe = subscribe((e) => {
        if (e.t === "Notification" && e.user !== user.id) return;
        pending.set(`${e.t}:${e.id ?? ""}`, { t: e.t, id: e.id, job: e.job, article: e.article });
        timer ??= setTimeout(flush, MERGE_MS);
      });

      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      send("retry: 3000\n\n: open\n\n");

      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        cleanup = () => {};
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
