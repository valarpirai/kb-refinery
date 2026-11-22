import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...a: unknown[]) => void;
interface FakeClient {
  url: string;
  handlers: Record<string, Handler>;
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  on: (e: string, h: Handler) => void;
}
const clients: FakeClient[] = [];
let connectError: Error | null = null;

vi.mock("pg", () => ({
  Client: class {
    handlers: Record<string, Handler> = {};
    connect = vi.fn(async () => {
      if (connectError) throw connectError;
    });
    query = vi.fn(async () => {});
    end = vi.fn(async () => {});
    removeAllListeners = vi.fn();
    constructor(opts: { connectionString: string }) {
      (this as unknown as FakeClient).url = opts.connectionString;
      clients.push(this as unknown as FakeClient);
    }
    on(e: string, h: Handler) {
      this.handlers[e] = h;
    }
  },
}));

const g = globalThis as unknown as { __kbEvents?: unknown };
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  clients.length = 0;
  connectError = null;
  delete g.__kbEvents;
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost/db?schema=public");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete g.__kbEvents;
});

describe("subscribe", () => {
  it("opens one connection without the query string and listens on kb_changes", async () => {
    const { subscribe } = await import("./events");
    subscribe(() => {});
    subscribe(() => {});
    await flush();
    expect(clients).toHaveLength(1);
    expect(clients[0].url).toBe("postgresql://u:p@localhost/db");
    expect(clients[0].query).toHaveBeenCalledWith("LISTEN kb_changes");
  });

  it("delivers parsed notifications to every listener", async () => {
    const { subscribe } = await import("./events");
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    await flush();
    clients[0].handlers.notification({ channel: "kb_changes", payload: JSON.stringify({ t: "job", id: "1" }) });
    expect(a).toHaveBeenCalledWith({ t: "job", id: "1" });
    expect(b).toHaveBeenCalledWith({ t: "job", id: "1" });
  });

  it("ignores other channels, empty payloads and bad JSON", async () => {
    const { subscribe } = await import("./events");
    const l = vi.fn();
    subscribe(l);
    await flush();
    const n = clients[0].handlers.notification;
    n({ channel: "other", payload: "{}" });
    n({ channel: "kb_changes", payload: "" });
    n({ channel: "kb_changes", payload: "{not json" });
    expect(l).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe and closes the connection with the last listener", async () => {
    const { subscribe } = await import("./events");
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe(a);
    const offB = subscribe(b);
    await flush();
    const c = clients[0];
    offA();
    expect(c.end).not.toHaveBeenCalled();
    c.handlers.notification({ channel: "kb_changes", payload: '{"t":"x"}' });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
    offB();
    expect(c.removeAllListeners).toHaveBeenCalled();
    expect(c.end).toHaveBeenCalledOnce();
  });

  it("reconnects after the connection drops while listeners remain", async () => {
    const { subscribe } = await import("./events");
    const l = vi.fn();
    subscribe(l);
    await flush();
    clients[0].handlers.error(new Error("lost"));
    expect(clients[0].end).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(clients).toHaveLength(2);
    clients[1].handlers.notification({ channel: "kb_changes", payload: '{"t":"y"}' });
    expect(l).toHaveBeenCalledWith({ t: "y" });
  });

  it("does not reconnect when no listeners remain", async () => {
    const { subscribe } = await import("./events");
    const off = subscribe(() => {});
    await flush();
    const first = clients[0];
    off();
    first.handlers.end?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(clients).toHaveLength(1);
  });

  it("retries when the first connect fails", async () => {
    connectError = new Error("refused");
    const { subscribe } = await import("./events");
    subscribe(() => {});
    await flush();
    expect(clients).toHaveLength(1);
    connectError = null;
    await vi.advanceTimersByTimeAsync(2000);
    expect(clients).toHaveLength(2);
    expect(clients[1].query).toHaveBeenCalledWith("LISTEN kb_changes");
  });
});
