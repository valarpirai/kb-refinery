# Running it

This is how to set the app up and run it. Use pnpm for everything. Do not use npm or yarn.

## You need

- Node 22 or newer
- pnpm
- PostgreSQL running on `localhost:5432`
- Ollama running, with the model pulled

## First-time setup

```bash
pnpm install
cp .env.example .env
psql -U postgres -h localhost -c "CREATE DATABASE kb_refinery"
psql -h localhost -d kb_refinery -c "CREATE EXTENSION IF NOT EXISTS vector"   # as a superuser
pnpm db:migrate
pnpm db:seed
ollama pull qwen3:4b-thinking-2507-q4_K_M
ollama pull nomic-embed-text
```

## Environment

All settings live in `.env`. The file is not committed. `.env.example` is.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | local `kb_refinery`, user `postgres` | Postgres connection |
| `SHADOW_DATABASE_URL` | scratch DB `kb_refinery_shadow` | Used only by `pnpm db:migrate`. See below. |
| `BETTER_AUTH_SECRET` | none. Required. | Signs sessions. `openssl rand -base64 32` |
| `ALLOW_SIGNUP` | `true` | `false` closes registration |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `admin@example.com`, `change-me-now` | The admin that `pnpm db:seed` creates |
| `TRACELOOP_API_KEY` | unset | If set, traces are also sent to Traceloop Cloud. See `agent.md`. |
| `HEARTBEAT_MS`, `HEARTBEAT_TIMEOUT_MS`, `MAX_ATTEMPTS` | 15000, 90000, 3 | Worker heartbeat, how long silence counts as dead, tries before giving up |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | `qwen3:4b-thinking-2507-q4_K_M` | Model to call |
| `OLLAMA_THINK` | `auto` | `auto`, `always` or `never`. See pipeline.md. |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Model that makes chat search vectors |
| `OLLAMA_NUM_CTX` | `16384` | Context window sent to Ollama |
| `OLLAMA_TIMEOUT_MS` | `600000` | Per-call timeout |
| `LLM_PROVIDER` | `ollama` | `ollama`, `anthropic` or `bedrock` |
| `AWS_BEARER_TOKEN_BEDROCK` | unset | Bedrock API key. Used when `LLM_PROVIDER=bedrock`. The usual AWS credential chain also works. |
| `AWS_REGION` | `us-east-1` | Bedrock region |
| `BEDROCK_MODEL` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Bedrock model or inference profile ID |
| `BEDROCK_MAX_TOKENS`, `BEDROCK_TIMEOUT_MS` | 16000, 600000 | Output cap and per-call timeout |

Bedrock has no structured output mode for Sonnet 4.5. The pipeline sends the JSON schema in the system prompt and checks the reply with zod. Chat embeddings still use Ollama.

## Daily commands

One command starts both the web server and the worker:

```bash
pnpm dev        # web at http://localhost:3000, plus the worker
```

Output is tagged `[web]` and `[worker]`. Ctrl+C stops both.

To run them apart, for example to restart only the worker:

```bash
pnpm dev:web    # web server only
pnpm worker     # worker only
```

The worker does not hot reload. After changing pipeline code, restart `pnpm dev`.

| Command | What it does |
|---|---|
| `pnpm db:migrate` | Apply schema changes |
| `pnpm db:seed` | Load sample data. Safe to run twice. |
| `pnpm db:reset` | Wipe the database, migrate, seed |
| `pnpm exec tsc --noEmit` | Type check |
| `pnpm lint` | Lint |

## First sign-in

After `pnpm db:seed`, sign in at `/login` with the admin from your `.env` (by default `admin@example.com` and `change-me-now`). Change that password for anything beyond your own machine. See `auth.md`.

## Start a run

With both processes up:

```bash
curl -X POST localhost:3000/api/jobs -H 'Content-Type: application/json' -d '{}'
```

An empty body refines every article. Pass `{"articleIds": ["..."]}` for some. The worker logs progress. Watch the `JobItem` table for status.

## Using another model

Set `OLLAMA_MODEL` and restart the worker. Any Ollama model that supports JSON output works. A model with a thinking mode gives better rewrites but runs much slower.

## pgvector

Chat search uses the pgvector extension. Installing an extension needs a superuser. The app's `postgres` role is not one, so a superuser must run `CREATE EXTENSION vector` in `kb_refinery` once. The migration then skips it.

`pnpm db:migrate` also replays all migrations in a scratch database. That database needs the extension too, and Prisma wipes it on each run. So `SHADOW_DATABASE_URL` points at a superuser role and a database called `kb_refinery_shadow`. Create that database once. The app itself never uses it.
