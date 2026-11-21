import { db } from "@/lib/db";
import { parseFile } from "./parsers";
import type { ParsedArticle, ParsedIncident, UploadKind } from "./types";

export interface InputFile {
  name: string;
  text: string;
  /** Where the content came from, saved on articles that do not name their own URL. */
  url?: string;
}

export interface ImportOptions {
  kind: UploadKind;
  files: InputFile[];
  label?: string;
  dataSourceId?: string | null;
  /** The user who started the import, so they can be notified. */
  userId?: string | null;
}

type Outcome = "created" | "updated" | "skipped";

/** Insert an article, update it when its content changed, or skip an identical one. */
async function upsertArticle(a: ParsedArticle, dataSourceId: string | null, importRunId: string): Promise<Outcome> {
  // A pulled item with no id is matched by title, so a scheduled pull does not re-create it every time.
  const externalId = a.externalId ?? (dataSourceId ? a.title : undefined);
  const existing = externalId
    ? await db.article.findFirst({ where: { externalId, dataSourceId } })
    : null;
  const data = {
    title: a.title,
    body: a.body,
    format: a.format,
    knowledgeBase: a.knowledgeBase ?? null,
    url: a.url ?? null,
    sourceUpdatedAt: a.sourceUpdatedAt ?? null,
  };
  if (!existing) {
    await db.article.create({ data: { ...data, externalId, dataSourceId, importRunId } });
    return "created";
  }
  if (existing.title === data.title && existing.body === data.body && existing.format === data.format) return "skipped";
  await db.article.update({ where: { id: existing.id }, data: { ...data, importRunId } });
  return "updated";
}

async function upsertIncident(i: ParsedIncident, importRunId: string): Promise<Outcome> {
  const data = {
    shortDescription: i.shortDescription,
    description: i.description ?? "",
    resolution: i.resolution ?? "",
    category: i.category ?? null,
    openedAt: i.openedAt ?? null,
  };
  const existing = await db.incident.findUnique({ where: { number: i.number } });
  if (!existing) {
    await db.incident.create({ data: { ...data, number: i.number, importRunId } });
    return "created";
  }
  const same =
    existing.shortDescription === data.shortDescription &&
    existing.description === data.description &&
    existing.resolution === data.resolution;
  if (same) return "skipped";
  await db.incident.update({ where: { number: i.number }, data: { ...data, importRunId } });
  return "updated";
}

/**
 * Parse and store a batch of uploaded files as one ImportRun.
 * A bad file or row is recorded in the run's errors and never stops the rest.
 */
export async function runImport({ kind, files, label, dataSourceId = null, userId = null }: ImportOptions) {
  const run = await db.importRun.create({
    data: {
      dataSourceId,
      userId,
      label: label ?? (files.length === 1 ? files[0].name : `${files.length} files`),
      status: "running",
    },
  });
  const counts = { total: 0, created: 0, updated: 0, skipped: 0 };
  const errors: string[] = [];

  for (const file of files) {
    const parsed = parseFile(kind, file.name, file.text);
    parsed.errors.forEach((e) => errors.push(`${file.name}: ${e}`));
    if (file.url && kind === "articles") for (const item of parsed.items) (item as ParsedArticle).url ??= file.url;
    for (const item of parsed.items) {
      counts.total++;
      try {
        const outcome =
          kind === "articles"
            ? await upsertArticle(item as ParsedArticle, dataSourceId, run.id)
            : await upsertIncident(item as ParsedIncident, run.id);
        counts[outcome]++;
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`);
      }
    }
  }

  const failedAll = counts.total === 0 && errors.length > 0;
  return db.importRun.update({
    where: { id: run.id },
    data: {
      ...counts,
      errors,
      finishedAt: new Date(),
      status: failedAll ? "failed" : errors.length ? "completed_with_errors" : "completed",
    },
  });
}
