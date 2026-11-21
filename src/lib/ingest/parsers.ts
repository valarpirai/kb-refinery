import matter from "gray-matter";
import Papa from "papaparse";
import type { ParsedArticle, ParsedIncident, ParseResult, UploadKind } from "./types";

type Row = Record<string, unknown>;

/** Lower-case a key and strip separators so `Short Description` matches `short_description`. */
function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Return the first non-empty value among the candidate column names. */
function pick(row: Row, names: string[]): string | undefined {
  const byKey = new Map(Object.keys(row).map((k) => [normKey(k), k]));
  for (const name of names) {
    const key = byKey.get(normKey(name));
    const value = key ? row[key] : undefined;
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return undefined;
}

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
}

function extOf(fileName: string): string {
  return (/\.([^.]+)$/.exec(fileName)?.[1] ?? "").toLowerCase();
}

function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype|html|body|h[1-6]|p|div|ul|ol|table)\b/i.test(text);
}

/** Map one CSV row or JSON object to an article. Returns an error string when unusable. */
function articleFromRow(row: Row, index: number): ParsedArticle | string {
  const body = pick(row, ["body", "content", "text", "article", "html", "markdown"]);
  const title = pick(row, ["title", "name", "shortdescription", "subject"]);
  if (!body) return `row ${index + 1}: no body/content column`;
  if (!title) return `row ${index + 1}: no title column`;
  const declared = pick(row, ["format"])?.toLowerCase();
  const format = declared === "html" || declared === "md" || declared === "text"
    ? declared
    : looksLikeHtml(body) ? "html" : "md";
  return {
    externalId: pick(row, ["externalid", "id", "number", "sysid"]),
    title,
    body,
    format,
    knowledgeBase: pick(row, ["knowledgebase", "kb", "kbname"]),
    url: pick(row, ["url", "link"]),
    sourceUpdatedAt: toDate(pick(row, ["updatedat", "updated", "sysupdatedon", "lastupdated"])),
  };
}

function incidentFromRow(row: Row, index: number): ParsedIncident | string {
  const number = pick(row, ["number", "id", "externalid"]);
  const shortDescription = pick(row, ["shortdescription", "title", "summary"]);
  if (!number) return `row ${index + 1}: no number/id column`;
  if (!shortDescription) return `row ${index + 1}: no short_description column`;
  return {
    number,
    shortDescription,
    description: pick(row, ["description", "details"]),
    resolution: pick(row, ["resolution", "closenotes", "solution"]),
    category: pick(row, ["category"]),
    openedAt: toDate(pick(row, ["openedat", "opened", "created"])),
  };
}

/** Read CSV text or JSON text into plain row objects. */
function toRows(fileName: string, text: string, key: string): { rows: Row[]; errors: string[] } {
  if (extOf(fileName) === "csv") {
    const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
    return { rows: parsed.data, errors: parsed.errors.map((e) => `row ${e.row ?? "?"}: ${e.message}`) };
  }
  try {
    const json = JSON.parse(text) as unknown;
    const list = Array.isArray(json) ? json : (json as Row)?.[key] ?? (json as Row)?.items;
    if (!Array.isArray(list)) return { rows: [], errors: [`JSON must be an array or { "${key}": [...] }`] };
    return { rows: list as Row[], errors: [] };
  } catch (e) {
    return { rows: [], errors: [`invalid JSON: ${(e as Error).message}`] };
  }
}

function mapRows<T>(rows: Row[], map: (row: Row, i: number) => T | string): ParseResult<T> {
  const items: T[] = [];
  const errors: string[] = [];
  rows.forEach((row, i) => {
    const out = map(row, i);
    if (typeof out === "string") errors.push(out);
    else items.push(out);
  });
  return { items, errors };
}

/** Parse a Markdown file with optional YAML front matter. */
function parseMarkdown(fileName: string, text: string): ParsedArticle {
  const { data, content } = matter(text);
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  return {
    externalId: data.id ? String(data.id) : baseName(fileName),
    title: String(data.title ?? heading ?? baseName(fileName)),
    body: content.trim(),
    format: "md",
    knowledgeBase: data.knowledgeBase ?? data.kb,
    url: data.url,
    sourceUpdatedAt: toDate(data.updated ? String(data.updated) : undefined),
  };
}

/** Parse a standalone HTML file. The whole document is kept as the body. */
function parseHtml(fileName: string, text: string): ParsedArticle {
  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] ??
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1] ??
    baseName(fileName);
  return {
    externalId: baseName(fileName),
    title: title.replace(/<[^>]+>/g, "").trim() || baseName(fileName),
    body: text.trim(),
    format: "html",
  };
}

/** Parse one uploaded file into articles. */
export function parseArticleFile(fileName: string, text: string): ParseResult<ParsedArticle> {
  switch (extOf(fileName)) {
    case "md":
    case "markdown":
      return { items: [parseMarkdown(fileName, text)], errors: [] };
    case "html":
    case "htm":
      return { items: [parseHtml(fileName, text)], errors: [] };
    case "txt":
      return { items: [{ externalId: baseName(fileName), title: baseName(fileName), body: text.trim(), format: "text" }], errors: [] };
    case "csv":
    case "json": {
      const { rows, errors } = toRows(fileName, text, "articles");
      const mapped = mapRows(rows, articleFromRow);
      return { items: mapped.items, errors: [...errors, ...mapped.errors] };
    }
    default:
      return { items: [], errors: [`unsupported file type: ${fileName}`] };
  }
}

/** Parse one uploaded file into incidents. Only CSV and JSON are meaningful here. */
export function parseIncidentFile(fileName: string, text: string): ParseResult<ParsedIncident> {
  const ext = extOf(fileName);
  if (ext !== "csv" && ext !== "json") return { items: [], errors: [`incidents need a CSV or JSON file: ${fileName}`] };
  const { rows, errors } = toRows(fileName, text, "incidents");
  const mapped = mapRows(rows, incidentFromRow);
  return { items: mapped.items, errors: [...errors, ...mapped.errors] };
}

export function parseFile(kind: UploadKind, fileName: string, text: string) {
  return kind === "articles" ? parseArticleFile(fileName, text) : parseIncidentFile(fileName, text);
}
