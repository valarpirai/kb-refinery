# Running it

This is how to set the app up and run it. Use pnpm for everything. Do not use npm or yarn.

## You need

- Node 22 or newer
- pnpm
- PostgreSQL running on `localhost:5432`
- Ollama running, with the model pulled

## First-time setup

```bash
cd web
pnpm install
cp .env.example .env
psql -U postgres -h localhost -c "CREATE DATABASE kb_refinery"
pnpm db:migrate
pnpm db:seed
ollama pull qwen3:4b-thinking-2507-q4_K_M
```

## Environment

All settings live in `web/.env`. The file is not committed. `.env.example` is.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | local `kb_refinery`, user `postgres` | Postgres connection |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | `qwen3:4b-thinking-2507-q4_K_M` | Model to call |
| `OLLAMA_THINK` | `auto` | `auto`, `always` or `never`. See pipeline.md. |
| `OLLAMA_NUM_CTX` | `16384` | Context window sent to Ollama |
| `OLLAMA_TIMEOUT_MS` | `600000` | Per-call timeout |

## Daily commands

Run the web server and the worker in two terminals.

```bash
pnpm dev        # web server, http://localhost:3000
pnpm worker     # pipeline worker
```

| Command | What it does |
|---|---|
| `pnpm db:migrate` | Apply schema changes |
| `pnpm db:seed` | Load sample data. Safe to run twice. |
| `pnpm db:reset` | Wipe the database, migrate, seed |
| `pnpm exec tsc --noEmit` | Type check |
| `pnpm lint` | Lint |

## Start a run

With both processes up:

```bash
curl -X POST localhost:3000/api/jobs -H 'Content-Type: application/json' -d '{}'
```

An empty body refines every article. Pass `{"articleIds": ["..."]}` for some. The worker logs progress. Watch the `JobItem` table for status.

## Using another model

Set `OLLAMA_MODEL` and restart the worker. Any Ollama model that supports JSON output works. A model with a thinking mode gives better rewrites but runs much slower.
