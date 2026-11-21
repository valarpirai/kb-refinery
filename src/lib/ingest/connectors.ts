import { z } from "zod";
import { db } from "@/lib/db";
import { runImport, type InputFile } from "./import";

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_URLS = 100;

const base = z.object({
  kind: z.enum(["articles", "incidents"]).default("articles"),
  /** Value sent as the Authorization header, for example "Bearer abc". Stored as plain text. */
  authHeader: z.string().optional(),
});

export const restJsonConfig = base.extend({
  url: z.url(),
  /** Dot path to the list inside the response, for example "result" or "data.items". Empty = the response itself. */
  itemsPath: z.string().optional(),
});

export const urlCrawlConfig = base.extend({
  urls: z.array(z.url()).min(1).max(MAX_URLS),
});

export const configSchemas = { rest_json: restJsonConfig, url_crawl: urlCrawlConfig } as const;

/**
 * Fetch a URL as text. Only http and https are allowed.
 * @param url address to fetch
 * @param authHeader optional Authorization header value
 * @return the response body
 */
async function fetchText(url: string, authHeader?: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  const res = await fetch(url, {
    headers: authHeader ? { Authorization: authHeader } : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`${url} is larger than 5 MB`);
  return text;
}

/**
 * Walk a dot path into parsed JSON.
 * @param json parsed response
 * @param path dot path such as data.items, or empty for the root
 * @return the value at the path
 */
function dig(json: unknown, path?: string): unknown {
  if (!path) return json;
  return path.split(".").reduce<unknown>((v, key) => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), json);
}

/** File name that is stable per URL, so a re-pull updates the same article. */
function slugFor(url: string): string {
  const u = new URL(url);
  return `${u.hostname}${u.pathname}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "page";
}

/** Turn a data source into the files the import service understands. */
async function collectFiles(type: string, config: unknown): Promise<{ kind: "articles" | "incidents"; files: InputFile[]; errors: string[] }> {
  if (type === "rest_json") {
    const c = restJsonConfig.parse(config);
    const json = JSON.parse(await fetchText(c.url, c.authHeader)) as unknown;
    const list = dig(json, c.itemsPath);
    if (!Array.isArray(list)) throw new Error(`No list found at "${c.itemsPath ?? "(root)"}" in the response`);
    return { kind: c.kind, files: [{ name: "pull.json", text: JSON.stringify(list) }], errors: [] };
  }
  if (type === "url_crawl") {
    const c = urlCrawlConfig.parse(config);
    const files: InputFile[] = [];
    const errors: string[] = [];
    // One dead page must not lose the others, so each URL fails on its own.
    for (const url of c.urls) {
      try {
        files.push({ name: `${slugFor(url)}.html`, text: await fetchText(url, c.authHeader) });
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (files.length === 0) throw new Error(errors[0] ?? "No pages could be fetched");
    return { kind: "articles", files, errors };
  }
  throw new Error(`Unknown connector type: ${type}`);
}

/**
 * Pull one data source now and record the result on it.
 * A failure is recorded, not thrown.
 * @param dataSourceId the source to pull
 * @return the import run, or null when the source is missing
 */
export async function pullSource(dataSourceId: string) {
  const source = await db.dataSource.findUnique({ where: { id: dataSourceId } });
  if (!source) return null;
  try {
    const { kind, files, errors } = await collectFiles(source.type, source.config);
    let run = await runImport({ kind, files, label: source.name, dataSourceId: source.id });
    if (errors.length > 0) {
      run = await db.importRun.update({
        where: { id: run.id },
        data: { errors: [...(run.errors as string[]), ...errors], status: "completed_with_errors" },
      });
    }
    await db.dataSource.update({
      where: { id: source.id },
      data: {
        lastRunAt: new Date(),
        lastStatus: run.status,
        lastMessage: `${run.created} created, ${run.updated} updated, ${run.skipped} unchanged${errors.length ? `; ${errors.length} URL(s) failed: ${errors[0]}` : ""}`.slice(0, 500),
      },
    });
    return run;
  } catch (e) {
    await db.dataSource.update({
      where: { id: source.id },
      data: { lastRunAt: new Date(), lastStatus: "failed", lastMessage: (e as Error).message.slice(0, 500) },
    });
    return null;
  }
}
