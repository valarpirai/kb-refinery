import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    analysis: { findUnique: vi.fn(), findMany: vi.fn() },
    snapshot: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("./embed", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [1, 2])),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { db } from "@/lib/db";
import { embed } from "./embed";
import { indexAll, indexArticle } from "./indexer";

const body = "word ".repeat(60);

function setup(opts: { stage?: string; snaps?: { type: string; content: string }[]; latest?: object | null } = {}) {
  vi.mocked(db.analysis.findUnique).mockResolvedValue({ id: "an1", pipelineStage: opts.stage ?? "ready", article: { title: "Title", body: `body ${body}` } } as never);
  vi.mocked(db.snapshot.findFirst).mockResolvedValue((opts.latest === undefined ? { version: 2 } : opts.latest) as never);
  vi.mocked(db.snapshot.findMany).mockResolvedValue((opts.snaps ?? [{ type: "raw", content: `raw ${body}` }, { type: "enriched", content: `enriched ${body}` }]) as never);
  const tx = { chunk: { deleteMany: vi.fn() }, $executeRaw: vi.fn() };
  vi.mocked(db.$transaction).mockImplementation((async (fn: (t: typeof tx) => Promise<void>) => fn(tx)) as never);
  return tx;
}

describe("indexArticle", () => {
  it("returns 0 when the article has no analysis", async () => {
    vi.mocked(db.analysis.findUnique).mockResolvedValue(null);
    await expect(indexArticle("a1")).resolves.toBe(0);
  });

  it("returns 0 when the pipeline has not finished", async () => {
    setup({ stage: "analyze" });
    await expect(indexArticle("a1")).resolves.toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 0 when there is no snapshot", async () => {
    setup({ latest: null });
    await expect(indexArticle("a1")).resolves.toBe(0);
  });

  it("returns 0 when there is no refined or converted text", async () => {
    setup({ snaps: [{ type: "raw", content: "x" }] });
    await expect(indexArticle("a1")).resolves.toBe(0);
  });

  it("replaces chunks for both variants and returns the count", async () => {
    const tx = setup();
    const n = await indexArticle("a1");
    expect(n).toBe(2);
    expect(tx.chunk.deleteMany).toHaveBeenCalledWith({ where: { articleId: "a1" } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const texts = vi.mocked(embed).mock.calls[0][0];
    expect(texts[0]).toContain("raw ");
    expect(texts[1]).toContain("enriched ");
    expect(vi.mocked(embed).mock.calls[0][1]).toBe("document");
  });

  it("falls back to converted text for the refined side", async () => {
    setup({ snaps: [{ type: "raw", content: `raw ${body}` }, { type: "converted", content: `converted ${body}` }] });
    await indexArticle("a1");
    expect(vi.mocked(embed).mock.calls[0][0][1]).toContain("converted ");
  });

  it("falls back to the article body when there is no raw snapshot", async () => {
    setup({ snaps: [{ type: "enriched", content: `enriched ${body}` }] });
    await indexArticle("a1");
    expect(vi.mocked(embed).mock.calls[0][0][0]).toContain("body ");
  });

  it("embeds in batches of 16", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `# H${i}\n${body}`).join("\n");
    setup({ snaps: [{ type: "raw", content: many }, { type: "enriched", content: many }] });
    const n = await indexArticle("a1");
    expect(n).toBe(40);
    expect(vi.mocked(embed).mock.calls.map((c) => c[0].length)).toEqual([16, 16, 8]);
  });

  it("does not touch the database when embedding fails", async () => {
    setup();
    vi.mocked(embed).mockRejectedValueOnce(new Error("down"));
    await expect(indexArticle("a1")).rejects.toThrow("down");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("indexAll", () => {
  it("counts indexed articles and continues past a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(db.analysis.findMany).mockResolvedValue([{ articleId: "a1" }, { articleId: "a2" }, { articleId: "a3" }] as never);
    setup();
    vi.mocked(embed)
      .mockResolvedValueOnce([[1], [1]])
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([[1], [1]]);
    await expect(indexAll()).resolves.toEqual({ indexed: 2, chunks: 4, failed: 1 });
  });

  it("does not count articles that produced no chunks", async () => {
    vi.mocked(db.analysis.findMany).mockResolvedValue([{ articleId: "a1" }] as never);
    vi.mocked(db.analysis.findUnique).mockResolvedValue(null);
    await expect(indexAll()).resolves.toEqual({ indexed: 0, chunks: 0, failed: 0 });
  });
});
