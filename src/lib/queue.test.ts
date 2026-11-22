import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const instances: { conn: string; start: ReturnType<typeof vi.fn>; createQueue: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[] = [];
vi.mock("pg-boss", () => ({
  PgBoss: class {
    start = vi.fn(async () => {});
    createQueue = vi.fn(async () => {});
    on = vi.fn();
    constructor(public conn: string) {
      instances.push(this as never);
    }
  },
}));

const g = globalThis as unknown as { boss?: unknown };

beforeEach(() => {
  instances.length = 0;
  delete g.boss;
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db?schema=public&sslmode=disable");
});
afterEach(() => {
  delete g.boss;
  vi.unstubAllEnvs();
});

describe("getBoss", () => {
  it("strips the schema parameter from the connection string", async () => {
    const { getBoss } = await import("./queue");
    await getBoss();
    expect(instances[0].conn).not.toContain("schema=");
    expect(instances[0].conn).toContain("sslmode=disable");
  });

  it("starts pg-boss and creates every queue", async () => {
    const q = await import("./queue");
    const boss = await q.getBoss();
    expect(instances[0].start).toHaveBeenCalledOnce();
    const names = instances[0].createQueue.mock.calls.map((c) => c[0]);
    expect(names).toEqual([q.REFINE_QUEUE, q.PULL_QUEUE, q.ANSWER_QUEUE, q.JUDGE_QUEUE, q.INDEX_QUEUE, q.AGENT_QUEUE, q.RECONCILE_QUEUE]);
    expect(boss).toBe(instances[0]);
  });

  it("reuses one instance across calls", async () => {
    const { getBoss } = await import("./queue");
    const [a, b] = await Promise.all([getBoss(), getBoss()]);
    expect(a).toBe(b);
    expect(instances).toHaveLength(1);
  });

  it("registers an error handler", async () => {
    const { getBoss } = await import("./queue");
    await getBoss();
    const [event, handler] = instances[0].on.mock.calls[0];
    expect(event).toBe("error");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handler(new Error("x"));
    expect(spy).toHaveBeenCalledWith("[pg-boss]", expect.any(Error));
  });

  it("rejects when DATABASE_URL is not a valid URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getBoss } = await import("./queue");
    await expect(getBoss()).rejects.toThrow();
  });
});

describe("getBoss failure recovery", () => {
  // Known bug: a failed start is cached forever, so every later call rejects too.
  it.fails("tries again after a failed start", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getBoss } = await import("./queue");
    await expect(getBoss()).rejects.toThrow();
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
    await expect(getBoss()).resolves.toBeDefined();
  });
});

describe("queue names", () => {
  it("are distinct", async () => {
    const q = await import("./queue");
    const names = [q.REFINE_QUEUE, q.PULL_QUEUE, q.ANSWER_QUEUE, q.JUDGE_QUEUE, q.INDEX_QUEUE, q.AGENT_QUEUE, q.RECONCILE_QUEUE];
    expect(new Set(names).size).toBe(names.length);
  });
});
