import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crawl } from ".././crawl";

type Page = { status?: number; type?: string; body: string } | Error;
const pages = new Map<string, Page>();
const fetchMock = vi.fn(async (url: string) => {
  const p = pages.get(url);
  if (!p) return { ok: false, status: 404, headers: new Headers(), text: async () => "" };
  if (p instanceof Error) throw p;
  return {
    ok: (p.status ?? 200) < 400,
    status: p.status ?? 200,
    headers: new Headers({ "content-type": p.type ?? "text/html; charset=utf-8" }),
    text: async () => p.body,
  };
});

const html = (...links: string[]) => `<html><body>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;

/** Run a crawl while skipping its polite delays. */
async function run(...args: Parameters<typeof crawl>) {
  const p = crawl(...args);
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  pages.clear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("crawl", () => {
  it("rejects non-http URLs", async () => {
    await expect(crawl("file:///etc/passwd", 1, false)).rejects.toThrow("Only http and https");
    await expect(crawl("ftp://x.com/", 1, false)).rejects.toThrow("Only http and https");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid URL", async () => {
    await expect(crawl("not a url", 1, false)).rejects.toThrow();
  });

  it("fetches only the start page when not following links", async () => {
    pages.set("https://a.com/", { body: html("/b") });
    const r = await run("https://a.com/", 5, false);
    expect(r.pages.map((p) => p.url)).toEqual(["https://a.com/"]);
    expect(r.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a user agent and html accept header", async () => {
    pages.set("https://a.com/", { body: "" });
    await run("https://a.com/", 1, false);
    const init = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers).toMatchObject({ Accept: "text/html", "User-Agent": "KB-Refinery/1.0" });
  });

  it("follows same-site links breadth first, without fragments or duplicates", async () => {
    pages.set("https://a.com/", { body: html("/b#top", "/c", "/b") });
    pages.set("https://a.com/b", { body: html("/d") });
    pages.set("https://a.com/c", { body: html("/") });
    pages.set("https://a.com/d", { body: html() });
    const r = await run("https://a.com/#frag", 10, true);
    expect(r.pages.map((p) => p.url)).toEqual(["https://a.com/", "https://a.com/b", "https://a.com/c", "https://a.com/d"]);
  });

  it("skips other origins, files by extension and malformed links", async () => {
    pages.set("https://a.com/", { body: html("https://b.com/x", "/doc.PDF", "/img.png", "/ok", "http://[bad", "mailto:x@y.z") });
    pages.set("https://a.com/ok", { body: html() });
    const r = await run("https://a.com/", 10, true);
    expect(r.pages.map((p) => p.url)).toEqual(["https://a.com/", "https://a.com/ok"]);
  });

  it("stops at maxPages", async () => {
    pages.set("https://a.com/", { body: html("/1", "/2", "/3") });
    for (const n of [1, 2, 3]) pages.set(`https://a.com/${n}`, { body: html() });
    const r = await run("https://a.com/", 2, true);
    expect(r.pages).toHaveLength(2);
  });

  it("clamps maxPages to between 1 and 50", async () => {
    pages.set("https://a.com/", { body: html("/1") });
    pages.set("https://a.com/1", { body: html() });
    expect((await run("https://a.com/", 0, true)).pages).toHaveLength(1);
    expect((await run("https://a.com/", -5, true)).pages).toHaveLength(1);
    const links = Array.from({ length: 60 }, (_, i) => `/p${i}`);
    pages.set("https://a.com/", { body: html(...links) });
    for (const l of links) pages.set(`https://a.com${l}`, { body: html() });
    expect((await run("https://a.com/", 500, true)).pages).toHaveLength(50);
  });

  it("records a failed page and carries on", async () => {
    pages.set("https://a.com/", { body: html("/bad", "/ok") });
    pages.set("https://a.com/bad", { status: 500, body: "" });
    pages.set("https://a.com/ok", { body: html() });
    const r = await run("https://a.com/", 10, true);
    expect(r.pages.map((p) => p.url)).toEqual(["https://a.com/", "https://a.com/ok"]);
    expect(r.errors).toEqual(["https://a.com/bad returned 500"]);
  });

  it("rejects non-HTML content", async () => {
    pages.set("https://a.com/", { type: "application/json", body: "{}" });
    const r = await run("https://a.com/", 1, false);
    expect(r.pages).toEqual([]);
    expect(r.errors[0]).toContain("is not an HTML page (application/json)");
  });

  it("rejects a page over 2 MB", async () => {
    pages.set("https://a.com/", { body: "x".repeat(2 * 1024 * 1024 + 1) });
    const r = await run("https://a.com/", 1, false);
    expect(r.errors[0]).toContain("larger than 2 MB");
  });

  it("records network errors", async () => {
    pages.set("https://a.com/", new Error("ECONNREFUSED"));
    const r = await run("https://a.com/", 1, false);
    expect(r.errors).toEqual(["ECONNREFUSED"]);
  });
});
