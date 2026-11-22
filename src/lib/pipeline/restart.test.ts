import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  jobItem: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  job: { update: vi.fn() },
  send: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { jobItem: h.jobItem, job: h.job } }));
vi.mock("@/lib/queue", () => ({ REFINE_QUEUE: "refine-article", getBoss: async () => ({ send: h.send }) }));

import { listFailedItems, restartJobItem } from "./restart";

const failedItem = (failedStage: string | null, extra: object = {}) => ({ id: "i1", jobId: "j1", status: "failed", failedStage, ...extra });

describe("restartJobItem", () => {
  beforeEach(() => {
    h.jobItem.update.mockResolvedValue({});
    h.job.update.mockResolvedValue({});
    h.send.mockResolvedValue("msg");
  });

  it("returns 404 for an unknown item and does nothing else", async () => {
    h.jobItem.findUnique.mockResolvedValue(null);
    expect(await restartJobItem("nope")).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(h.jobItem.update).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each(["pending", "converting", "analyzing", "completed", "skipped"])("returns 409 for a %s item", async (status) => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("analyze", { status }));
    expect(await restartJobItem("i1")).toEqual({ ok: false, status: 409, error: "Only a failed article can be restarted" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("restarts from the failed stage by default", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("enrich"));
    expect(await restartJobItem("i1")).toEqual({ ok: true, fromStage: "enrich" });
  });

  it("defaults to convert when no failed stage was recorded", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem(null));
    expect(await restartJobItem("i1")).toEqual({ ok: true, fromStage: "convert" });
  });

  it("allows an earlier stage", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("rewrite"));
    expect(await restartJobItem("i1", "analyze")).toEqual({ ok: true, fromStage: "analyze" });
  });

  it("allows the failed stage itself", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("analyze"));
    expect(await restartJobItem("i1", "analyze")).toEqual({ ok: true, fromStage: "analyze" });
  });

  it("refuses a stage after the failed one with 400 and changes nothing", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("analyze"));
    const r = await restartJobItem("i1", "rewrite");
    expect(r).toEqual({ ok: false, status: 400, error: "It failed at analyze. Restart from there or earlier." });
    expect(h.jobItem.update).not.toHaveBeenCalled();
    expect(h.job.update).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("resets the item to pending, keeping the resume point in failedStage and counting the restart", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("enrich"));
    await restartJobItem("i1", "analyze");
    expect(h.jobItem.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "pending", message: null, failedStage: "analyze", restarts: { increment: 1 } },
    });
  });

  it("reopens the job", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("convert"));
    await restartJobItem("i1");
    expect(h.job.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: { status: "running", completedAt: null } });
  });

  it("queues one message ahead of the backlog with the resume stage", async () => {
    h.jobItem.findUnique.mockResolvedValue(failedItem("rewrite"));
    await restartJobItem("i1");
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith("refine-article", { jobItemId: "i1", fromStage: "rewrite" }, { priority: 10 });
  });

  it("runs the second restart of an already restarted item as refused, since it is now pending", async () => {
    const row = failedItem("analyze");
    h.jobItem.findUnique.mockImplementation(async () => ({ ...row }));
    h.jobItem.update.mockImplementation(async ({ data }: { data: { status: string } }) => Object.assign(row, data));
    expect((await restartJobItem("i1")).ok).toBe(true);
    const again = await restartJobItem("i1");
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe("listFailedItems", () => {
  const item = (articleId: string, updatedAt: string) => ({ id: `i-${articleId}`, articleId, status: "failed", updatedAt: new Date(updatedAt), article: { title: articleId } });

  it("queries the newest failed item per article", async () => {
    h.jobItem.findMany.mockResolvedValue([]);
    await listFailedItems(5);
    expect(h.jobItem.findMany).toHaveBeenCalledWith({
      where: { status: "failed" }, orderBy: { updatedAt: "desc" }, distinct: ["articleId"], include: { article: { select: { title: true } } },
    });
  });

  it("returns [] when nothing failed", async () => {
    h.jobItem.findMany.mockResolvedValue([]);
    expect(await listFailedItems(5)).toEqual([]);
  });

  it("drops an article that a later non-failed run has superseded", async () => {
    const a = item("a", "2026-01-02"); const b = item("b", "2026-01-01");
    h.jobItem.findMany.mockResolvedValue([a, b]);
    h.jobItem.count.mockImplementation(async ({ where }: { where: { articleId: string } }) => (where.articleId === "a" ? 1 : 0));
    expect(await listFailedItems(10)).toEqual([b]);
  });

  it("asks about later runs with the right filter", async () => {
    const a = item("a", "2026-01-02");
    h.jobItem.findMany.mockResolvedValue([a]);
    h.jobItem.count.mockResolvedValue(0);
    await listFailedItems(10);
    expect(h.jobItem.count).toHaveBeenCalledWith({ where: { articleId: "a", status: { not: "failed" }, updatedAt: { gt: a.updatedAt } } });
  });

  it("stops at the limit and does not query for the rest", async () => {
    const items = [item("a", "2026-01-03"), item("b", "2026-01-02"), item("c", "2026-01-01")];
    h.jobItem.findMany.mockResolvedValue(items);
    h.jobItem.count.mockResolvedValue(0);
    expect(await listFailedItems(2)).toEqual(items.slice(0, 2));
    expect(h.jobItem.count).toHaveBeenCalledTimes(2);
  });

  it("returns nothing for a limit of zero", async () => {
    h.jobItem.findMany.mockResolvedValue([item("a", "2026-01-01")]);
    expect(await listFailedItems(0)).toEqual([]);
    expect(h.jobItem.count).not.toHaveBeenCalled();
  });
});
