# Ingestion

This is how articles and incidents get into the database.

## Today: file upload

Go to `/import`. Pick articles or incidents. Choose files. Upload.

The page posts to `POST /api/import`. Limits: 200 files, 10 MB each.

## File types

### Articles

| Type | Result |
|---|---|
| `.md`, `.markdown` | One article. Front matter is read. Title comes from front matter, then the first `#` heading, then the file name. |
| `.html`, `.htm` | One article. Title comes from `<title>`, then the first `<h1>`, then the file name. |
| `.txt` | One article. Title is the file name. |
| `.csv` | Many articles. One per row. |
| `.json` | Many articles. A list, or `{"articles": [...]}`. |

Markdown front matter keys: `id`, `title`, `kb` or `knowledgeBase`, `url`, `updated`.

CSV and JSON need a title and a body. Column names are matched loosely. `Short Description` and `short_description` are the same.

| Field | Accepted names |
|---|---|
| Title | `title`, `name`, `short_description`, `subject` |
| Body | `body`, `content`, `text`, `article`, `html`, `markdown` |
| Id | `id`, `external_id`, `number`, `sys_id` |
| Knowledge base | `knowledge_base`, `kb`, `kb_name` |
| URL | `url`, `link` |
| Updated | `updated_at`, `updated`, `sys_updated_on`, `last_updated` |
| Format | `format`: `html`, `md` or `text`. Guessed from the body if missing. |

### Incidents

CSV or JSON only. Needs `number` and `short_description`. Optional: `description`, `resolution` (or `close_notes`), `category`, `opened_at`.

## Re-uploading

The app matches on id. For markdown and HTML files the id is the file name. Upload the same file again and:

- Same content: skipped.
- Changed content: updated.
- New id: created.

A row without an id is always created. Nothing can match it.

## Errors

A bad file or row does not stop the rest. The run records each problem. The page shows the first ten. The run status is `completed_with_errors`, or `failed` if nothing was usable.

## Where the code is

| File | Job |
|---|---|
| `src/lib/ingest/parsers.ts` | Turns file text into records |
| `src/lib/ingest/import.ts` | Saves records, counts results |
| `src/app/api/import/route.ts` | The upload endpoint |
| `src/components/upload-form.tsx` | The upload form |

## Planned: integrations

An Integrations page will let you connect an outside source and pull on a schedule. The `DataSource` table is ready. First connectors: a REST or JSON endpoint, and a URL crawl. Pulls will run through the same queue as the pipeline, and use the same import service.
