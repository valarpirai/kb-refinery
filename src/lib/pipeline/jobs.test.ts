import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (jobs: { data: Record<string, unknown> }[]) => Promise<void>;

const h = vi.hoisted(() => ({
  db: {
    article: { findMany: vi.fn() },
    job: { create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    jobItem: { findMany: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  },
  notify: vi.fn(),
  send: vi.fn(),
  work: vi.fn(),
  schedule: vi.fn(),
  processJobItem: vi.fn(),
  pullSource: vi.fn(),
  syncAllSchedules: vi.fn(),
  answerArm: vi.fn(),
  judgeComparison: vi.fn(),
  indexAll: vi.fn(),
  runAgentMessage: vi.fn(),
  reconcileJobs: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/notify", () => ({ notify: h.notify }));
vi.mock("@/lib/ingest/connectors", () => ({ pullSource: h.pullSource }));
vi.mock("@/lib/ingest/schedule", () => ({ syncAllSchedules: h.syncAllSchedules }));
vi.mock("@/lib/chat/answer", () => ({ answerArm: h.answerArm, judgeComparison: h.judgeComparison }));
vi.mock("@/lib/chat/indexer", () => ({ indexAll: h.indexAll }));
vi.mock("@/lib/agent/run", () => ({ runAgentMessage: h.runAgentMessage }));
vi.mock("./reconcile", () => ({ reconcileJobs: h.reconcileJobs }));
vi.mock("./run-article", () => ({ processJobItem: h.processJobItem }));
vi.mock("@/lib/queue", () => ({
  REFINE_QUEUE: "refine-article", PULL_QUEUE: "pull-source", ANSWER_QUEUE: "answer-arm", JUDGE_QUEUE: "judge-comparison",
  INDEX_QUEUE: "index-articles", AGENT_QUEUE: "agent-message", RECONCILE_QUEUE: "reconcile-jobs",
  getBoss: async () => ({ send: h.send, work: h.work, schedule: h.schedule }),
}));

import { createJob, finalizeJobIfDone, startWorker } from "./jobs";
import { WORKER_ID } from "./worker-id";

describe("createJob", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}` }));

  beforeEach(() => {
    h.db.job.create.mockImplementation(async ({ data }: { data: { items: { create: { articleId: string }[] } } }) => ({
      id: "j1", items: data.items.create.map((c, i) => ({ id: `i${i}`, ...c })),
    }));
    h.send.mockResolvedValue("m");
  });

  it("throws and queues nothing when there are no articles", async () => {
    h.db.article.findMany.mockResolvedValue([]);
    await expect(createJob(["x"])).rejects.toThrow("No articles to refine");
    expect(h.db.job.create).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("selects only the given articles, or all when none are given", async () => {
    h.db.article.findMany.mockResolvedValue(ids(1));
    await createJob(["a0"]);
    expect(h.db.article.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["a0"] } }, orderBy: { createdAt: "asc" } });
    await createJob();
    expect(h.db.article.findMany.mock.calls[1][0].where).toBeUndefined();
  });

  it("creates a pending job with totals, batches and one item per article", async () => {
    h.db.article.findMany.mockResolvedValue(ids(7));
    await createJob(undefined, undefined, "u1");
    const data = h.db.job.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: "u1", status: "pending", articlesTotal: 7, remainingBatches: 2, scope: "All articles" });
    expect(data.items.create.map((c: { batchNumber: number }) => c.batchNumber)).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  it("uses a selection label, or the caller's scope", async () => {
    h.db.article.findMany.mockResolvedValue(ids(2));
    await createJob(["a0", "a1"]);
    expect(h.db.job.create.mock.calls[0][0].data.scope).toBe("2 selected article(s)");
    await createJob(["a0", "a1"], "My scope");
    expect(h.db.job.create.mock.calls[1][0].data.scope).toBe("My scope");
  });

  it("stores a null user when none is given", async () => {
    h.db.article.findMany.mockResolvedValue(ids(1));
    await createJob();
    expect(h.db.job.create.mock.calls[0][0].data.userId).toBeNull();
  });

  it("rounds exact multiples of the batch size correctly", async () => {
    h.db.article.findMany.mockResolvedValue(ids(10));
    await createJob();
    expect(h.db.job.create.mock.calls[0][0].data.remainingBatches).toBe(2);
  });

  it("queues exactly one message per created item and returns the job", async () => {
    h.db.article.findMany.mockResolvedValue(ids(3));
    const job = await createJob();
    expect(h.send).toHaveBeenCalledTimes(3);
    expect(h.send.mock.calls.map((c) => c[1])).toEqual([{ jobItemId: "i0" }, { jobItemId: "i1" }, { jobItemId: "i2" }]);
    expect(h.send.mock.calls.every((c) => c[0] === "refine-article")).toBe(true);
    expect(job.id).toBe("j1");
  });
});

describe("finalizeJobIfDone", () => {
  const items = (...statuses: string[]) => h.db.jobItem.findMany.mockResolvedValue(statuses.map((status) => ({ status })));

  beforeEach(() => {
    h.db.job.updateMany.mockResolvedValue({ count: 1 });
    h.db.job.findUniqueOrThrow.mockResolvedValue({ id: "j1", userId: "u1", findingsGenerated: 4 });
  });

  it.each(["pending", "converting", "analyzing", "enriching", "scoring"])("does nothing while an item is %s", async (open) => {
    items("completed", open);
    await finalizeJobIfDone("j1");
    expect(h.db.job.updateMany).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("completes the job when all items completed or were skipped", async () => {
    items("completed", "completed", "skipped");
    await finalizeJobIfDone("j1");
    const arg = h.db.job.updateMany.mock.calls[0][0];
    expect(arg.data).toMatchObject({ status: "completed", remainingBatches: 0, articlesSkipped: 1, articlesProcessed: 2 });
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  it("completes a job whose items were all skipped", async () => {
    items("skipped", "skipped");
    await finalizeJobIfDone("j1");
    expect(h.db.job.updateMany.mock.calls[0][0].data).toMatchObject({ status: "completed", articlesProcessed: 0, articlesSkipped: 2 });
  });

  it("is completed_with_errors for a mix with failures", async () => {
    items("completed", "failed", "skipped");
    await finalizeJobIfDone("j1");
    expect(h.db.job.updateMany.mock.calls[0][0].data).toMatchObject({ status: "completed_with_errors", articlesProcessed: 1, articlesSkipped: 1 });
  });

  it("is failed when every item failed", async () => {
    items("failed", "failed");
    await finalizeJobIfDone("j1");
    expect(h.db.job.updateMany.mock.calls[0][0].data).toMatchObject({ status: "failed", articlesProcessed: 0 });
  });

  it("only flips a job that is not already final", async () => {
    items("completed");
    await finalizeJobIfDone("j1");
    expect(h.db.job.updateMany.mock.calls[0][0].where).toEqual({ id: "j1", status: { notIn: ["completed", "completed_with_errors", "failed"] } });
  });

  it("stays silent when another call already finalized the job", async () => {
    items("completed");
    h.db.job.updateMany.mockResolvedValue({ count: 0 });
    await finalizeJobIfDone("j1");
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.db.job.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("notifies once with a success message and singular and plural wording", async () => {
    items("completed", "completed");
    await finalizeJobIfDone("j1");
    expect(h.notify).toHaveBeenCalledWith("u1", { level: "success", title: "Refining finished", body: "2 of 2 articles done. 4 findings found.", href: "/jobs/j1" });
    h.db.job.findUniqueOrThrow.mockResolvedValue({ id: "j1", userId: "u1", findingsGenerated: 1 });
    items("completed");
    await finalizeJobIfDone("j1");
    expect(h.notify.mock.calls[1][1].body).toBe("1 of 1 article done. 1 finding found.");
  });

  it("notifies a warning with the failure count for a partial failure", async () => {
    items("completed", "failed");
    await finalizeJobIfDone("j1");
    expect(h.notify).toHaveBeenCalledWith("u1", expect.objectContaining({ level: "warning", title: "Refining finished with errors", body: "1 of 2 articles done, 1 failed. You can restart the failed ones." }));
  });

  it("notifies an error when everything failed", async () => {
    items("failed");
    await finalizeJobIfDone("j1");
    expect(h.notify).toHaveBeenCalledWith("u1", expect.objectContaining({ level: "error", title: "Refining failed" }));
  });

  it("handles a job with no items by completing it", async () => {
    items();
    await finalizeJobIfDone("j1");
    expect(h.db.job.updateMany.mock.calls[0][0].data.status).toBe("completed");
  });

  it("is safe to call twice: the second call does not notify again", async () => {
    items("completed");
    h.db.job.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await finalizeJobIfDone("j1");
    await finalizeJobIfDone("j1");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});

describe("startWorker", () => {
  const handlers = new Map<string, Handler>();
  const run = (queue: string, ...data: Record<string, unknown>[]) => handlers.get(queue)!(data.map((d) => ({ data: d })));

  /** A tiny in-memory item table so the claim step behaves like the real atomic update. */
  const table: { id: string; jobId: string; status: string; attempts: number; claimedBy: string | null }[] = [];

  beforeEach(async () => {
    handlers.clear();
    table.length = 0;
    table.push({ id: "i1", jobId: "j1", status: "pending", attempts: 0, claimedBy: null });
    h.work.mockImplementation(async (queue: string, fn: Handler) => void handlers.set(queue, fn));
    h.db.jobItem.updateMany.mockImplementation(async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
      const hit = table.filter((r) => r.id === where.id && r.status === where.status);
      for (const r of hit) Object.assign(r, { status: data.status, claimedBy: data.claimedBy, attempts: r.attempts + 1 });
      return { count: hit.length };
    });
    h.db.jobItem.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => table.find((r) => r.id === where.id));
    h.db.job.updateMany.mockResolvedValue({ count: 1 });
    h.db.jobItem.findMany.mockResolvedValue([{ status: "completed" }]);
    h.db.job.findUniqueOrThrow.mockResolvedValue({ id: "j1", userId: "u1", findingsGenerated: 0 });
    h.processJobItem.mockImplementation(async (id: string) => void (table.find((r) => r.id === id)!.status = "completed"));
    h.syncAllSchedules.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await startWorker();
  });

  it("registers a handler for every queue and schedules the reconciler every minute", () => {
    expect([...handlers.keys()].sort()).toEqual(["agent-message", "answer-arm", "index-articles", "judge-comparison", "pull-source", "reconcile-jobs", "refine-article"]);
    expect(h.schedule).toHaveBeenCalledWith("reconcile-jobs", "* * * * *", {}, { key: "reconcile" });
    expect(h.syncAllSchedules).toHaveBeenCalled();
  });

  it("claims a pending item, runs it from convert and finalizes the job", async () => {
    await run("refine-article", { jobItemId: "i1" });
    expect(h.processJobItem).toHaveBeenCalledWith("i1", "convert");
    expect(table[0]).toMatchObject({ status: "completed", claimedBy: WORKER_ID, attempts: 1 });
    expect(h.db.jobItem.findMany).toHaveBeenCalledWith({ where: { jobId: "j1" }, select: { status: true } });
  });

  it("claims only items that are pending", async () => {
    await run("refine-article", { jobItemId: "i1" });
    expect(h.db.jobItem.updateMany.mock.calls[0][0].where).toEqual({ id: "i1", status: "pending" });
  });

  it.each([
    ["convert", "converting"],
    ["analyze", "analyzing"],
    ["enrich", "enriching"],
    ["rewrite", "scoring"],
  ])("claims a resume at %s as %s", async (fromStage, status) => {
    await run("refine-article", { jobItemId: "i1", fromStage });
    expect(h.db.jobItem.updateMany.mock.calls[0][0].data.status).toBe(status);
    expect(h.processJobItem).toHaveBeenCalledWith("i1", fromStage);
  });

  it("records the claim with this worker id, a heartbeat and an attempt", async () => {
    await run("refine-article", { jobItemId: "i1" });
    const data = h.db.jobItem.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ claimedBy: WORKER_ID, attempts: { increment: 1 } });
    expect(data.heartbeatAt).toBeInstanceOf(Date);
  });

  it("moves a finished or pending job back to running", async () => {
    await run("refine-article", { jobItemId: "i1" });
    const arg = h.db.job.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "j1", status: { in: ["pending", "completed", "completed_with_errors", "failed"] } });
    expect(arg.data).toMatchObject({ status: "running", completedAt: null });
  });

  it("drops a duplicate queue message: the item is processed only once", async () => {
    await run("refine-article", { jobItemId: "i1" }, { jobItemId: "i1" });
    await run("refine-article", { jobItemId: "i1" });
    expect(h.processJobItem).toHaveBeenCalledTimes(1);
    expect(table[0].attempts).toBe(1);
  });

  it("drops a message for an item another worker holds", async () => {
    table[0].status = "analyzing";
    table[0].claimedBy = "other";
    await run("refine-article", { jobItemId: "i1" });
    expect(h.processJobItem).not.toHaveBeenCalled();
    expect(table[0].claimedBy).toBe("other");
  });

  it("drops a message for an unknown item", async () => {
    await run("refine-article", { jobItemId: "ghost" });
    expect(h.processJobItem).not.toHaveBeenCalled();
  });

  it("processes a batch in order", async () => {
    table.push({ id: "i2", jobId: "j1", status: "pending", attempts: 0, claimedBy: null });
    await run("refine-article", { jobItemId: "i1" }, { jobItemId: "i2" });
    expect(h.processJobItem.mock.calls.map((c) => c[0])).toEqual(["i1", "i2"]);
  });

  it("does not finalize when processing throws", async () => {
    h.processJobItem.mockRejectedValueOnce(new Error("boom"));
    await expect(run("refine-article", { jobItemId: "i1" })).rejects.toThrow("boom");
    expect(h.db.jobItem.findMany).not.toHaveBeenCalled();
  });

  it("routes the other queues to their workers", async () => {
    await run("pull-source", { dataSourceId: "d1" });
    await run("answer-arm", { armId: "r1" });
    await run("agent-message", { assistantId: "m1" });
    await run("reconcile-jobs", {});
    expect(h.pullSource).toHaveBeenCalledWith("d1");
    expect(h.answerArm).toHaveBeenCalledWith("r1");
    expect(h.runAgentMessage).toHaveBeenCalledWith("m1");
    expect(h.reconcileJobs).toHaveBeenCalledTimes(1);
  });

  it("logs the index result", async () => {
    h.indexAll.mockResolvedValue({ articles: 2 });
    await handlers.get("index-articles")!([]);
    expect(console.log).toHaveBeenCalledWith("[index]", { articles: 2 });
  });

  it("swallows a judge failure with a warning but lets answer failures through", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.judgeComparison.mockRejectedValueOnce(new Error("judge failed"));
    await expect(run("judge-comparison", { comparisonId: "c1" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[judge]", "judge failed");
    h.answerArm.mockRejectedValueOnce(new Error("answer failed"));
    await expect(run("answer-arm", { armId: "r1" })).rejects.toThrow("answer failed");
  });
});
