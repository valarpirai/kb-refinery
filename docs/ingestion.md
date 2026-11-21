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

## The agent on upload

On the Import page, **Let the agent refine these for me** is ticked by default for articles. When the upload brings new or changed articles, the app opens a chat conversation and hands the import to the agent. The agent starts the refine job, and you get a notification when it ends. Untick the box to skip that. Scheduled pulls do the same. See `agent.md`.

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

## Integrations: scheduled pulls

Go to `/integrations`. Add a source. The worker pulls it on its schedule and imports with the same service as uploads.

### Connectors

| Type | Config | Pulls |
|---|---|---|
| REST / JSON | `url`, optional `itemsPath`, `kind`, `authHeader` | One GET. The response, or the list at `itemsPath`, is read like a JSON upload. |
| Web pages | `urls` (up to 100), optional `authHeader` | Each page is fetched and read like an HTML upload. |

`itemsPath` is a dot path such as `result` or `data.items`. Empty means the response itself is the list.

### Matching on re-pull

Each source keeps its own articles. An item matches on its id. With no id, it matches on its title. A page pulled by URL matches on a name made from the URL. So a repeat pull updates or skips. It does not pile up copies.

### Schedules

A schedule is a cron expression, for example `0 2 * * *` for daily at 02:00. Leave it empty for manual pulls only. The cron runs in the queue (`pg-boss`), one schedule per source. The worker re-applies every schedule when it starts.

Pause stops the schedule. Resume restores it. Run now queues one pull. Both need the worker running.

### Results

Each pull makes an import run, shown on the source row and in import history. A bad row or a dead URL is recorded and the rest still import. A page that fails to load does not stop the other pages.

### Safety

- Only `http` and `https` URLs are fetched. Time limit is 30 seconds. Size limit is 5 MB.
- The server fetches whatever URL you give it, including addresses on your own network. Anyone with an account can add a source, so give accounts only to people you trust.
- The authorization header is saved as plain text in your local database. The API never returns it. The page shows only that one is set.
- To change a source's connection, delete it and add it again.

### Where the code is

| File | Job |
|---|---|
| `src/lib/ingest/connectors.ts` | Fetches a source and runs the import |
| `src/lib/ingest/schedule.ts` | Keeps queue schedules in step with the table |
| `src/app/api/sources/` | Create, update, delete, run now |
| `src/app/integrations/page.tsx` | The page |
