import { parse } from "node-html-parser";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2 * 1024 * 1024;
const SKIP_EXT = /\.(pdf|zip|gz|tar|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|mp4|mp3|woff2?)$/i;

export interface CrawledPage {
  url: string;
  html: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  errors: string[];
}

/** Fetch one page as HTML text. Throws a short message when it is not usable. */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": "KB-Refinery/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) throw new Error(`${url} is not an HTML page (${type || "no type"})`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`${url} is larger than 2 MB`);
  return text;
}

/** Same-site links on a page, without fragments, in page order. */
function linksOf(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const found: string[] = [];
  for (const a of parse(html).querySelectorAll("a[href]")) {
    try {
      const u = new URL(a.getAttribute("href") ?? "", base);
      u.hash = "";
      if (u.origin !== origin || SKIP_EXT.test(u.pathname)) continue;
      found.push(u.toString());
    } catch {
      /* ignore a malformed link */
    }
  }
  return found;
}

/**
 * Fetch a page and, optionally, the pages it links to on the same site.
 * Breadth first, one request at a time, with a short pause between requests.
 * A page that fails is recorded and the crawl goes on.
 * @param startUrl the first page. Only http and https are allowed.
 * @param maxPages how many pages to fetch at most (1 to 50)
 * @param followLinks whether to follow same-site links from each page
 * @return the pages fetched and any problems
 */
export async function crawl(startUrl: string, maxPages: number, followLinks: boolean): Promise<CrawlResult> {
  const start = new URL(startUrl);
  if (start.protocol !== "http:" && start.protocol !== "https:") throw new Error("Only http and https URLs can be fetched");
  start.hash = "";
  const limit = Math.min(Math.max(Math.floor(maxPages), 1), 50);
  const queue = [start.toString()];
  const seen = new Set(queue);
  const pages: CrawledPage[] = [];
  const errors: string[] = [];

  while (queue.length > 0 && pages.length < limit) {
    const url = queue.shift()!;
    try {
      const html = await fetchHtml(url);
      pages.push({ url, html });
      if (followLinks) {
        for (const link of linksOf(html, url)) {
          if (!seen.has(link) && seen.size < limit * 4) {
            seen.add(link);
            queue.push(link);
          }
        }
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { pages, errors };
}
