import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  dataSource: { findUnique: vi.fn(), update: vi.fn() },
  importRun: { update: vi.fn() },
}));
const runImport = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const startAgentTurn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db }));
vi.mock(".././import", () => ({ runImport }));
vi.mock("@/lib/notify", () => ({ notify }));
vi.mock("@/lib/agent/start", () => ({ startAgentTurn }));

import { pullSource, restJsonConfig, urlCrawlConfig } from ".././connectors";

const fetchMock = vi.fn();
const ok = (text: string) => ({ ok: true, status: 200, text: async () => text });
const baseRun = { id: "r1", status: "completed", created: 2, updated: 1, skipped: 3, errors: [] as string[] };

function source(type: string, config: unknown) {
  db.dataSource.findUnique.mockResolvedValue({ id: "s1", name: "Src", type, config, userId: "u1" });
}
const lastUpdate = () => db.dataSource.update.mock.calls.at(-1)![0].data;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  runImport.mockResolvedValue({ ...baseRun });
  startAgentTurn.mockResolvedValue(undefined);
  notify.mockResolvedValue(undefined);
  db.dataSource.update.mockResolvedValue({});
  db.importRun.update.mockImplementation(async (a: { data: object }) => ({ ...baseRun, ...a.data }));
});

describe("config schemas", () => {
  it("defaults kind and validates urls", () => {
    expect(restJsonConfig.parse({ url: "http://a.com" }).kind).toBe("articles");
    expect(() => restJsonConfig.parse({ url: "nope" })).toThrow();
    expect(() => urlCrawlConfig.parse({ urls: [] })).toThrow();
    expect(() => urlCrawlConfig.parse({ urls: Array(101).fill("http://a.com") })).toThrow();
  });
});

describe("pullSource", () => {
  it("returns null for a missing source", async () => {
    db.dataSource.findUnique.mockResolvedValue(null);
    expect(await pullSource("x")).toBeNull();
    expect(db.dataSource.update).not.toHaveBeenCalled();
  });

  it("pulls rest_json, digs the items path and sends the auth header", async () => {
    source("rest_json", { url: "http://api/x", itemsPath: "data.items", authHeader: "Bearer t" });
    fetchMock.mockResolvedValue(ok(JSON.stringify({ data: { items: [{ title: "a", body: "b" }] } })));
    const run = await pullSource("s1");
    expect(fetchMock.mock.calls[0][0]).toBe("http://api/x");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer t" });
    expect(runImport).toHaveBeenCalledWith({
      kind: "articles",
      files: [{ name: "pull.json", text: JSON.stringify([{ title: "a", body: "b" }]) }],
      label: "Src",
      dataSourceId: "s1",
      userId: "u1",
    });
    expect(run).toMatchObject({ id: "r1" });
    expect(lastUpdate()).toMatchObject({ lastStatus: "completed", lastMessage: "2 created, 1 updated, 3 unchanged" });
    expect(lastUpdate().lastRunAt).toBeInstanceOf(Date);
  });

  it("uses the response root when no items path is set and omits headers without auth", async () => {
    source("rest_json", { url: "http://api/x", kind: "incidents" });
    fetchMock.mockResolvedValue(ok("[]"));
    await pullSource("s1");
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
    expect(runImport.mock.calls[0][0]).toMatchObject({ kind: "incidents" });
  });

  it("records a failure when the path holds no list", async () => {
    source("rest_json", { url: "http://api/x", itemsPath: "a.b" });
    fetchMock.mockResolvedValue(ok('{"a":{"b":5}}'));
    expect(await pullSource("s1")).toBeNull();
    expect(lastUpdate()).toMatchObject({ lastStatus: "failed", lastMessage: 'No list found at "a.b" in the response' });
    expect(notify).toHaveBeenCalledWith("u1", expect.objectContaining({ level: "error", title: "Pull failed: Src" }));
    expect(runImport).not.toHaveBeenCalled();
  });

  it("does not crash on a path through null", async () => {
    source("rest_json", { url: "http://api/x", itemsPath: "a.b.c" });
    fetchMock.mockResolvedValue(ok('{"a":null}'));
    expect(await pullSource("s1")).toBeNull();
    expect(lastUpdate().lastStatus).toBe("failed");
  });

  it("records HTTP errors, invalid JSON and bad config", async () => {
    source("rest_json", { url: "http://api/x" });
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    await pullSource("s1");
    expect(lastUpdate().lastMessage).toBe("http://api/x returned 500");

    fetchMock.mockResolvedValue(ok("not json"));
    await pullSource("s1");
    expect(lastUpdate().lastStatus).toBe("failed");

    source("rest_json", { url: "bogus" });
    await pullSource("s1");
    expect(lastUpdate().lastStatus).toBe("failed");
  });

  it("rejects unsupported protocols without fetching", async () => {
    source("rest_json", { url: "ftp://host/file" });
    await pullSource("s1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastUpdate().lastMessage).toContain("Unsupported protocol: ftp:");
  });

  it("rejects bodies over 5 MB", async () => {
    source("rest_json", { url: "http://api/x" });
    fetchMock.mockResolvedValue(ok("x".repeat(5 * 1024 * 1024 + 1)));
    await pullSource("s1");
    expect(lastUpdate().lastMessage).toContain("larger than 5 MB");
  });

  it("fails on an unknown connector type", async () => {
    source("ftp", {});
    expect(await pullSource("s1")).toBeNull();
    expect(lastUpdate().lastMessage).toBe("Unknown connector type: ftp");
  });

  it("truncates long failure messages", async () => {
    source("rest_json", { url: "http://api/x" });
    fetchMock.mockRejectedValue(new Error("e".repeat(900)));
    await pullSource("s1");
    expect(lastUpdate().lastMessage).toHaveLength(500);
    expect(notify.mock.calls[0][1].body).toHaveLength(300);
  });
});

describe("pullSource url_crawl", () => {
  it("builds stable file names and attaches nothing extra", async () => {
    source("url_crawl", { urls: ["https://Docs.example.com/a/b?x=1", "https://example.com/"] });
    fetchMock.mockResolvedValue(ok("<p>hi</p>"));
    await pullSource("s1");
    const { files, kind } = runImport.mock.calls[0][0];
    expect(kind).toBe("articles");
    expect(files.map((f: { name: string }) => f.name)).toEqual(["docs-example-com-a-b.html", "example-com.html"]);
  });

  it("keeps good pages when one fails and flags the run", async () => {
    source("url_crawl", { urls: ["http://a.com/1", "http://a.com/2"] });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" }).mockResolvedValueOnce(ok("<p>x</p>"));
    runImport.mockResolvedValue({ ...baseRun, errors: ["old"] });
    const run = await pullSource("s1");
    expect(runImport.mock.calls[0][0].files).toHaveLength(1);
    expect(db.importRun.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { errors: ["old", "http://a.com/1 returned 404"], status: "completed_with_errors" },
    });
    expect(run!.status).toBe("completed_with_errors");
    expect(lastUpdate().lastMessage).toBe("2 created, 1 updated, 3 unchanged; 1 URL(s) failed: http://a.com/1 returned 404");
    expect(notify.mock.calls[0][1].level).toBe("warning");
  });

  it("fails when every page fails", async () => {
    source("url_crawl", { urls: ["http://a.com/1", "http://a.com/2"] });
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    expect(await pullSource("s1")).toBeNull();
    expect(lastUpdate()).toMatchObject({ lastStatus: "failed", lastMessage: "http://a.com/1 returned 500" });
  });
});

describe("pullSource notifications and agent", () => {
  beforeEach(() => {
    source("rest_json", { url: "http://api/x" });
    fetchMock.mockResolvedValue(ok("[]"));
  });

  it("notifies success and starts the agent for new or changed articles", async () => {
    await pullSource("s1");
    expect(notify).toHaveBeenCalledWith("u1", { level: "success", title: "Pulled Src", body: "2 new, 1 updated, 3 unchanged.", href: "/integrations" });
    expect(startAgentTurn).toHaveBeenCalledWith("u1", expect.stringContaining("import run id: r1"), { title: "Pull: Src" });
  });

  it("warns when the run itself has errors", async () => {
    runImport.mockResolvedValue({ ...baseRun, errors: ["row 1"] });
    await pullSource("s1");
    expect(notify.mock.calls[0][1].level).toBe("warning");
  });

  it("skips the agent when nothing changed, for incidents, or without a user", async () => {
    runImport.mockResolvedValue({ ...baseRun, created: 0, updated: 0 });
    await pullSource("s1");
    source("rest_json", { url: "http://api/x", kind: "incidents" });
    runImport.mockResolvedValue({ ...baseRun });
    await pullSource("s1");
    db.dataSource.findUnique.mockResolvedValue({ id: "s1", name: "Src", type: "rest_json", config: { url: "http://api/x" }, userId: null });
    await pullSource("s1");
    expect(startAgentTurn).not.toHaveBeenCalled();
  });

  it("swallows an agent start failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    startAgentTurn.mockRejectedValue(new Error("agent down"));
    const run = await pullSource("s1");
    expect(run).toMatchObject({ id: "r1" });
    expect(warn).toHaveBeenCalledWith("[agent]", "agent down");
    expect(lastUpdate().lastStatus).toBe("completed");
  });

  it("records failure when runImport throws", async () => {
    runImport.mockRejectedValue(new Error("import boom"));
    expect(await pullSource("s1")).toBeNull();
    expect(lastUpdate()).toMatchObject({ lastStatus: "failed", lastMessage: "import boom" });
  });
});
