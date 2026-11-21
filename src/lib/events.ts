import { Client } from "pg";

/** One row change, as sent by the `kb_notify_change` trigger. Ids only, never row data. */
export interface ChangeEvent {
  t: string;
  id?: string;
  job?: string;
  article?: string;
  user?: string;
}

type Listener = (e: ChangeEvent) => void;

const CHANNEL = "kb_changes";
const RETRY_MS = 2000;

interface State {
  listeners: Set<Listener>;
  client: Client | null;
  starting: boolean;
}

const g = globalThis as unknown as { __kbEvents?: State };
const state: State = (g.__kbEvents ??= { listeners: new Set(), client: null, starting: false });

/** Open the one LISTEN connection for this process. Reconnects when it drops. */
async function connect(): Promise<void> {
  if (state.client || state.starting) return;
  state.starting = true;
  const url = (process.env.DATABASE_URL ?? "").split("?")[0];
  const client = new Client({ connectionString: url });
  const drop = () => {
    if (state.client !== client && !state.starting) return;
    state.client = null;
    state.starting = false;
    client.removeAllListeners();
    client.end().catch(() => {});
    if (state.listeners.size > 0) setTimeout(() => void connect(), RETRY_MS);
  };
  client.on("error", drop);
  client.on("end", drop);
  client.on("notification", (m) => {
    if (m.channel !== CHANNEL || !m.payload) return;
    let e: ChangeEvent;
    try {
      e = JSON.parse(m.payload) as ChangeEvent;
    } catch {
      return;
    }
    for (const l of state.listeners) l(e);
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    state.client = client;
    state.starting = false;
  } catch {
    drop();
  }
}

/**
 * Listen for row changes made by any process, including the worker.
 * The first subscriber opens the connection. The last one to leave closes it.
 * @param listener called once per change
 * @return a function that stops listening
 */
export function subscribe(listener: Listener): () => void {
  state.listeners.add(listener);
  void connect();
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.client) {
      const c = state.client;
      state.client = null;
      c.removeAllListeners();
      c.end().catch(() => {});
    }
  };
}
