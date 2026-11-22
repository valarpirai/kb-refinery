import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };

const h = vi.hoisted(() => {
  const state = { items: [] as Row[], jobs: [] as Row[], analyses: [] as Row[] };
  return {
    state,
    send: vi.fn(),
    notify: vi.fn(),
    finalize: vi.fn(),
    /** Hook that runs once after the next findMany, to simulate a worker waking up mid-reconcile. */
    afterRead: { fn: null as null | (() => void) },
  };
});

/**
 * Match a row against a small subset of Prisma where syntax.
 * @param row the row
 * @param where the filter
 * @return true when the row matches
 */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(row, w));
    const val = row[k];
    if (v instanceof Date) return val instanceof Date && val.getTime() === v.getTime();
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("in" in o) return (o.in as unknown[]).includes(val);
      if ("lt" in o) return val != null && (val as Date) < (o.lt as Date);
      if ("gt" in o) return val != null && (val as Date) > (o.gt as Date);
    }
    return val === v;
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    jobItem: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const out = h.state.items.filter((r) => matches(r, where)).slice(0, take).map((r) => ({ ...r }));
        h.afterRead.fn?.();
        h.afterRead.fn = null;
        return out;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = h.state.items.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data, { updatedAt: new Date(Date.now() + 1) });
        return { count: hit.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = h.state.items.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
    },
    job: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.state.jobs.find((j) => j.id === where.id) ?? null) },
    analysis: { update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(h.state.analyses.find((a) => a.id === where.id)!, data)) },
  },
}));
vi.mock("@/lib/notify", () => ({ notify: h.notify }));
vi.mock("@/lib/queue", () => ({ REFINE_QUEUE: "refine-article", getBoss: async () => ({ send: h.send }) }));
vi.mock("./jobs", () => ({ finalizeJobIfDone: h.finalize }));

import { reconcileJobs } from "./reconcile";
import { HEARTBEAT_TIMEOUT_MS, MAX_ATTEMPTS } from "./worker-id";

const NOW = new Date("2026-06-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/**
 * Add a job item to the fake table.
 * @param id item id
 * @param extra fields overriding the defaults
 * @return the stored row
 */
function item(id: string, extra: Record<string, unknown> = {}): Row {
  const row: Row = {
    id, jobId: "j1", articleId: `art-${id}`, status: "analyzing", attempts: 1, claimedBy: "w1", analysisId: null, failedStage: null, message: null,
    heartbeatAt: ago(HEARTBEAT_TIMEOUT_MS + 5_000), updatedAt: ago(HEARTBEAT_TIMEOUT_MS + 5_000), ...extra,
  };
  h.state.items.push(row);
  return row;
}
const get = (id: string) => h.state.items.find((r) => r.id === id)!;

describe("reconcileJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.state.items = [];
    h.state.jobs = [{ id: "j1", userId: "u1" }];
    h.state.analyses = [{ id: "an1", pipelineStage: "analyzing" }];
    h.afterRead.fn = null;
    h.send.mockResolvedValue("m");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing when no item is stale", async () => {
    item("a", { heartbeatAt: ago(1_000), updatedAt: ago(1_000) });
    expect(await reconcileJobs()).toEqual({ recovered: 0, failed: 0, requeued: 0 });
    expect(h.send).not.toHaveBeenCalled();
    expect(get("a").status).toBe("analyzing");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("returns an abandoned item to the queue at the stage it was on", async () => {
    item("a", { status: "enriching" });
    const summary = await reconcileJobs();
    expect(summary).toEqual({ recovered: 1, failed: 0, requeued: 0 });
    expect(get("a")).toMatchObject({ status: "pending", failedStage: "enrich", claimedBy: null, message: "Recovered after the worker stopped responding" });
    expect(h.send).toHaveBeenCalledWith("refine-article", { jobItemId: "a", fromStage: "enrich" }, { priority: 5 });
  });

  it.each([
    ["converting", "convert"],
    ["analyzing", "analyze"],
    ["enriching", "enrich"],
    ["scoring", "rewrite"],
  ])("maps status %s to stage %s", async (status, stage) => {
    item("a", { status });
    await reconcileJobs();
    expect(h.send).toHaveBeenCalledWith("refine-article", { jobItemId: "a", fromStage: stage }, { priority: 5 });
  });

  it("leaves pending, completed, failed and skipped items alone", async () => {
    for (const s of ["pending", "completed", "failed", "skipped"]) item(s, { status: s, updatedAt: ago(5_000) });
    expect(await reconcileJobs()).toEqual({ recovered: 0, failed: 0, requeued: 0 });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("treats a heartbeat exactly at the cutoff as alive and one just past it as dead", async () => {
    item("edge", { heartbeatAt: ago(HEARTBEAT_TIMEOUT_MS), updatedAt: ago(HEARTBEAT_TIMEOUT_MS) });
    item("dead", { heartbeatAt: ago(HEARTBEAT_TIMEOUT_MS + 1), updatedAt: ago(HEARTBEAT_TIMEOUT_MS + 1) });
    await reconcileJobs();
    expect(get("edge").status).toBe("analyzing");
    expect(get("dead").status).toBe("pending");
  });

  it("falls back to updatedAt when an item never sent a heartbeat", async () => {
    item("old", { heartbeatAt: null, updatedAt: ago(HEARTBEAT_TIMEOUT_MS + 1_000) });
    item("new", { heartbeatAt: null, updatedAt: ago(1_000) });
    await reconcileJobs();
    expect(get("old").status).toBe("pending");
    expect(get("new").status).toBe("analyzing");
  });

  it("recovers an item that has been claimed fewer than MAX_ATTEMPTS times", async () => {
    item("a", { attempts: MAX_ATTEMPTS - 1 });
    expect((await reconcileJobs()).recovered).toBe(1);
  });

  it("fails an item after MAX_ATTEMPTS, notifies the owner and finalizes the job", async () => {
    item("a", { attempts: MAX_ATTEMPTS, status: "scoring", analysisId: "an1" });
    const summary = await reconcileJobs();
    expect(summary).toEqual({ recovered: 0, failed: 1, requeued: 0 });
    expect(get("a")).toMatchObject({ status: "failed", failedStage: "rewrite", claimedBy: null });
    expect(get("a").message).toBe(`The worker stopped responding ${MAX_ATTEMPTS} times while at the rewrite stage. Restart it to try again.`);
    expect(h.state.analyses[0].pipelineStage).toBe("failed");
    expect(h.finalize).toHaveBeenCalledWith("j1");
    expect(h.notify).toHaveBeenCalledWith("u1", expect.objectContaining({ level: "error", href: "/jobs/j1" }));
    expect(h.send).not.toHaveBeenCalled();
  });

  it("fails an item without an analysis without touching analyses", async () => {
    item("a", { attempts: MAX_ATTEMPTS, analysisId: null });
    await reconcileJobs();
    expect(h.state.analyses[0].pipelineStage).toBe("analyzing");
    expect(get("a").status).toBe("failed");
  });

  it("notifies nobody-owned jobs with a null user", async () => {
    h.state.jobs = [];
    item("a", { attempts: MAX_ATTEMPTS });
    await reconcileJobs();
    expect(h.notify).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it("skips an item whose worker sent a heartbeat after it was read", async () => {
    item("a");
    h.afterRead.fn = () => Object.assign(get("a"), { heartbeatAt: new Date(NOW.getTime()), updatedAt: new Date(NOW.getTime()) });
    expect(await reconcileJobs()).toEqual({ recovered: 0, failed: 0, requeued: 0 });
    expect(get("a").status).toBe("analyzing");
    expect(get("a").claimedBy).toBe("w1");
    expect(h.send).not.toHaveBeenCalled();
  });

  it("does not fail an item that finished between the read and the write", async () => {
    item("a", { attempts: MAX_ATTEMPTS });
    h.afterRead.fn = () => Object.assign(get("a"), { status: "completed" });
    expect(await reconcileJobs()).toEqual({ recovered: 0, failed: 0, requeued: 0 });
    expect(get("a").status).toBe("completed");
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("is idempotent: a second run does not recover or queue the same item again", async () => {
    item("a");
    await reconcileJobs();
    const second = await reconcileJobs();
    expect(second).toEqual({ recovered: 0, failed: 0, requeued: 0 });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("lets only one of two concurrent reconcilers win an item", async () => {
    item("a");
    const [x, y] = await Promise.all([reconcileJobs(), reconcileJobs()]);
    expect(x.recovered + y.recovered).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("handles several items in one run, mixing recover and fail", async () => {
    item("a"); item("b", { status: "converting" }); item("c", { attempts: MAX_ATTEMPTS });
    expect(await reconcileJobs()).toEqual({ recovered: 2, failed: 1, requeued: 0 });
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("surfaces a queue error to the caller", async () => {
    item("a");
    h.send.mockRejectedValueOnce(new Error("queue down"));
    await expect(reconcileJobs()).rejects.toThrow("queue down");
  });

  it("logs a summary only when something changed", async () => {
    item("a");
    await reconcileJobs();
    expect(console.log).toHaveBeenCalledWith("[reconcile]", { recovered: 1, failed: 0, requeued: 0 });
  });
});

describe("reconcileJobs: lost queue messages", () => {
  const HOUR = 60 * 60 * 1000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.state.items = [];
    h.state.jobs = [{ id: "j1", userId: "u1" }];
    h.send.mockResolvedValue("m");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("re-sends a message for an item pending over an hour, at its resume stage", async () => {
    item("a", { status: "pending", failedStage: "enrich", heartbeatAt: null, updatedAt: ago(HOUR + 1_000) });
    expect(await reconcileJobs()).toEqual({ recovered: 0, failed: 0, requeued: 1 });
    expect(h.send).toHaveBeenCalledWith("refine-article", { jobItemId: "a", fromStage: "enrich" });
  });

  it("starts at convert when the pending item has no resume point", async () => {
    item("a", { status: "pending", failedStage: null, heartbeatAt: null, updatedAt: ago(HOUR + 1_000) });
    await reconcileJobs();
    expect(h.send).toHaveBeenCalledWith("refine-article", { jobItemId: "a", fromStage: "convert" });
  });

  it("ignores items pending for less than an hour", async () => {
    item("a", { status: "pending", heartbeatAt: null, updatedAt: ago(HOUR - 1_000) });
    expect((await reconcileJobs()).requeued).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("touches updatedAt so the same item is not re-sent on the next tick", async () => {
    item("a", { status: "pending", heartbeatAt: null, updatedAt: ago(HOUR + 1_000) });
    await reconcileJobs();
    expect((await reconcileJobs()).requeued).toBe(0);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("does not both recover an abandoned item and re-queue it in the same run", async () => {
    item("a");
    const s = await reconcileJobs();
    expect(s.recovered).toBe(1);
    expect(s.requeued).toBe(0);
  });

  it("re-queues at most 50 per run", async () => {
    for (let i = 0; i < 60; i++) item(`p${i}`, { status: "pending", heartbeatAt: null, updatedAt: ago(HOUR + 1_000) });
    expect((await reconcileJobs()).requeued).toBe(50);
    expect((await reconcileJobs()).requeued).toBe(10);
  });
});
