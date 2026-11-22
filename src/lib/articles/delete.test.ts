import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  article: { findMany: vi.fn(), deleteMany: vi.fn() },
  mention: { findMany: vi.fn(), count: vi.fn() },
  jobItem: { findMany: vi.fn() },
  product: { update: vi.fn() },
}));
const finalizeJobIfDone = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/pipeline/jobs", () => ({ finalizeJobIfDone }));

import { deleteArticles } from "./delete";

beforeEach(() => {
  db.article.findMany.mockResolvedValue([]);
  db.mention.findMany.mockResolvedValue([]);
  db.jobItem.findMany.mockResolvedValue([]);
  db.article.deleteMany.mockResolvedValue({ count: 0 });
});

describe("deleteArticles", () => {
  it("queries busy articles by in-progress job item status", async () => {
    await deleteArticles(["a"]);
    expect(db.article.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["a"] },
      jobItems: { some: { status: { in: ["converting", "analyzing", "enriching", "scoring"] } } },
    });
  });

  it("deletes everything when none are busy", async () => {
    db.article.deleteMany.mockResolvedValue({ count: 2 });
    const r = await deleteArticles(["a", "b"]);
    expect(r).toEqual({ deleted: 2, busy: [] });
    expect(db.article.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } } });
  });

  it("skips busy articles and reports them", async () => {
    db.article.findMany.mockResolvedValue([{ id: "b", title: "B" }]);
    db.article.deleteMany.mockResolvedValue({ count: 1 });
    const r = await deleteArticles(["a", "b"]);
    expect(r).toEqual({ deleted: 1, busy: [{ id: "b", title: "B" }] });
    expect(db.article.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } } });
  });

  it("does nothing more when all are busy", async () => {
    db.article.findMany.mockResolvedValue([{ id: "a", title: "A" }]);
    const r = await deleteArticles(["a"]);
    expect(r).toEqual({ deleted: 0, busy: [{ id: "a", title: "A" }] });
    expect(db.article.deleteMany).not.toHaveBeenCalled();
    expect(db.mention.findMany).not.toHaveBeenCalled();
    expect(finalizeJobIfDone).not.toHaveBeenCalled();
  });

  it("handles an empty id list", async () => {
    expect(await deleteArticles([])).toEqual({ deleted: 0, busy: [] });
    expect(db.article.deleteMany).not.toHaveBeenCalled();
  });

  it("recounts products and finalizes jobs after the delete", async () => {
    const order: string[] = [];
    db.mention.findMany.mockResolvedValue([{ productId: "p1" }, { productId: "p2" }]);
    db.jobItem.findMany.mockResolvedValue([{ jobId: "j1" }]);
    db.article.deleteMany.mockImplementation(async () => (order.push("delete"), { count: 1 }));
    db.mention.count.mockImplementation(async ({ where }: { where: { productId: string } }) => (order.push("count"), where.productId === "p1" ? 5 : 0));
    db.product.update.mockImplementation(async () => (order.push("update"), {}));
    finalizeJobIfDone.mockImplementation(async () => (order.push("finalize"), undefined));
    await deleteArticles(["a"]);
    expect(order[0]).toBe("delete");
    expect(db.product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { articleCount: 5 } });
    expect(db.product.update).toHaveBeenCalledWith({ where: { id: "p2" }, data: { articleCount: 0 } });
    expect(finalizeJobIfDone).toHaveBeenCalledWith("j1");
    expect(order.indexOf("finalize")).toBeGreaterThan(order.lastIndexOf("update"));
  });

  it("collects products and jobs only for the deletable articles", async () => {
    db.article.findMany.mockResolvedValue([{ id: "b", title: "B" }]);
    db.article.deleteMany.mockResolvedValue({ count: 1 });
    await deleteArticles(["a", "b"]);
    expect(db.mention.findMany.mock.calls[0][0].where).toEqual({ analysis: { articleId: { in: ["a"] } } });
    expect(db.jobItem.findMany.mock.calls[0][0].where).toEqual({ articleId: { in: ["a"] } });
  });
});
