import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  importRun: { create: vi.fn(), update: vi.fn() },
  article: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  incident: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { runImport } from ".././import";

beforeEach(() => {
  db.importRun.create.mockResolvedValue({ id: "run1" });
  db.importRun.update.mockImplementation(async (a: { data: object }) => ({ id: "run1", ...a.data }));
  db.article.findFirst.mockResolvedValue(null);
});

const finalData = () => db.importRun.update.mock.calls[0][0].data;

describe("runImport articles", () => {
  it("creates new articles and completes", async () => {
    const run = await runImport({ kind: "articles", files: [{ name: "a.md", text: "# T\nbody" }] });
    expect(db.importRun.create.mock.calls[0][0].data).toMatchObject({ label: "a.md", status: "running", dataSourceId: null, userId: null });
    expect(db.article.create.mock.calls[0][0].data).toMatchObject({ title: "T", externalId: "a", importRunId: "run1", dataSourceId: null, url: null, knowledgeBase: null });
    expect(run).toMatchObject({ total: 1, created: 1, updated: 0, skipped: 0, status: "completed", errors: [] });
    expect(finalData().finishedAt).toBeInstanceOf(Date);
  });

  it("labels multi-file runs and honours an explicit label", async () => {
    await runImport({ kind: "articles", files: [{ name: "a.txt", text: "x" }, { name: "b.txt", text: "y" }] });
    expect(db.importRun.create.mock.calls[0][0].data.label).toBe("2 files");
    await runImport({ kind: "articles", files: [], label: "Src" });
    expect(db.importRun.create.mock.calls[1][0].data.label).toBe("Src");
  });

  it("skips an identical existing article", async () => {
    db.article.findFirst.mockResolvedValue({ id: "x", title: "a", body: "x", format: "text" });
    const run = await runImport({ kind: "articles", files: [{ name: "a.txt", text: "x" }] });
    expect(run.skipped).toBe(1);
    expect(db.article.create).not.toHaveBeenCalled();
    expect(db.article.update).not.toHaveBeenCalled();
  });

  it("updates a changed article", async () => {
    db.article.findFirst.mockResolvedValue({ id: "x", title: "a", body: "old", format: "text" });
    const run = await runImport({ kind: "articles", files: [{ name: "a.txt", text: "new" }] });
    expect(run.updated).toBe(1);
    expect(db.article.update).toHaveBeenCalledWith({ where: { id: "x" }, data: expect.objectContaining({ body: "new", importRunId: "run1" }) });
  });

  it("looks up by externalId and data source", async () => {
    await runImport({ kind: "articles", files: [{ name: "a.txt", text: "x" }], dataSourceId: "ds" });
    expect(db.article.findFirst).toHaveBeenCalledWith({ where: { externalId: "a", dataSourceId: "ds" } });
  });

  it("matches id-less pulled items by title", async () => {
    const json = JSON.stringify([{ title: "T", body: "b" }].map(({ title, body }) => ({ name: title, body })));
    await runImport({ kind: "articles", files: [{ name: "pull.json", text: json }], dataSourceId: "ds" });
    expect(db.article.findFirst).toHaveBeenCalledWith({ where: { externalId: "T", dataSourceId: "ds" } });
    expect(db.article.create.mock.calls[0][0].data.externalId).toBe("T");
  });

  it("does not look up id-less items without a data source", async () => {
    const json = JSON.stringify([{ title: "T", body: "b" }]);
    await runImport({ kind: "articles", files: [{ name: "up.json", text: json }] });
    expect(db.article.findFirst).not.toHaveBeenCalled();
    expect(db.article.create).toHaveBeenCalled();
  });

  it("fills the url from the file only when the article has none", async () => {
    const json = JSON.stringify([{ title: "A", body: "b", url: "http://own" }, { title: "B", body: "b" }]);
    await runImport({ kind: "articles", files: [{ name: "x.json", text: json, url: "http://file" }] });
    expect(db.article.create.mock.calls[0][0].data.url).toBe("http://own");
    expect(db.article.create.mock.calls[1][0].data.url).toBe("http://file");
  });

  it("records a failing row and continues", async () => {
    db.article.create.mockRejectedValueOnce(new Error("db down")).mockResolvedValue({});
    const run = await runImport({ kind: "articles", files: [{ name: "a.txt", text: "x" }, { name: "b.txt", text: "y" }] });
    expect(run).toMatchObject({ total: 2, created: 1, status: "completed_with_errors", errors: ["a.txt: db down"] });
  });

  it("marks the run failed when nothing parsed and errors exist", async () => {
    const run = await runImport({ kind: "articles", files: [{ name: "a.pdf", text: "x" }] });
    expect(run.status).toBe("failed");
    expect((run.errors as string[])[0]).toMatch(/^a\.pdf: unsupported/);
  });

  it("marks completed_with_errors when some rows parse", async () => {
    const json = JSON.stringify([{ title: "t" }, { title: "ok", body: "b" }]);
    const run = await runImport({ kind: "articles", files: [{ name: "x.json", text: json }] });
    expect(run).toMatchObject({ created: 1, status: "completed_with_errors" });
  });

  it("completes an empty run with no errors", async () => {
    const run = await runImport({ kind: "articles", files: [] });
    expect(run.status).toBe("completed");
  });

  it("passes data source and user to the run", async () => {
    await runImport({ kind: "articles", files: [], dataSourceId: "ds", userId: "u" });
    expect(db.importRun.create.mock.calls[0][0].data).toMatchObject({ dataSourceId: "ds", userId: "u" });
  });
});

describe("runImport incidents", () => {
  const csv = "number,short_description,description,resolution\nINC1,VPN,d,r\n";

  it("creates a new incident with defaults", async () => {
    db.incident.findUnique.mockResolvedValue(null);
    const run = await runImport({ kind: "incidents", files: [{ name: "i.json", text: JSON.stringify([{ number: "I", shortDescription: "s" }]) }] });
    expect(db.incident.create.mock.calls[0][0].data).toMatchObject({ number: "I", description: "", resolution: "", category: null, openedAt: null, importRunId: "run1" });
    expect(run.created).toBe(1);
  });

  it("skips an unchanged incident", async () => {
    db.incident.findUnique.mockResolvedValue({ shortDescription: "VPN", description: "d", resolution: "r" });
    const run = await runImport({ kind: "incidents", files: [{ name: "i.csv", text: csv }] });
    expect(run.skipped).toBe(1);
    expect(db.incident.update).not.toHaveBeenCalled();
  });

  it("updates a changed incident", async () => {
    db.incident.findUnique.mockResolvedValue({ shortDescription: "VPN", description: "d", resolution: "old" });
    const run = await runImport({ kind: "incidents", files: [{ name: "i.csv", text: csv }] });
    expect(run.updated).toBe(1);
    expect(db.incident.update).toHaveBeenCalledWith({ where: { number: "INC1" }, data: expect.objectContaining({ resolution: "r" }) });
  });

  it("does not apply file urls to incidents", async () => {
    db.incident.findUnique.mockResolvedValue(null);
    await runImport({ kind: "incidents", files: [{ name: "i.csv", text: csv, url: "http://f" }] });
    expect(db.incident.create.mock.calls[0][0].data).not.toHaveProperty("url");
  });
});
