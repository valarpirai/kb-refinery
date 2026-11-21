# Architecture

This is what the app is made of and how the parts talk.

## Stack

| Part | Choice |
|---|---|
| Web framework | Next.js 15, App Router, TypeScript |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL, local |
| ORM | Prisma 6 |
| Queue | pg-boss, stored in the same Postgres |
| LLM | Ollama, model `qwen3:4b-thinking-2507-q4_K_M` |
| Package manager | pnpm |
| Agent | Strands Agents SDK (TypeScript) |
| Tracing | Traceloop (OpenLLMetry), stored in Postgres |
| Auth | Better Auth, email and password |

## Two processes

The app runs as two processes.

1. **Web server.** Next.js. It serves pages and the API. It accepts uploads and starts jobs.
2. **Worker.** A plain Node script. It takes articles off the queue and runs the pipeline. It calls Ollama. It also runs scheduled source pulls, chat answers and indexing.

They share one database. The web server never calls the LLM. The worker never serves a request. A slow model cannot block a page.

```
Browser ──> Next.js ──> Postgres <── Worker ──> Ollama
              │            ▲
              └─ pg-boss ──┘
```

## Folder map

| Path | Holds |
|---|---|
| `src/app/` | Pages and API routes |
| `src/components/` | React components |
| `src/lib/db.ts` | The shared Prisma client |
| `src/lib/queue.ts` | The shared pg-boss instance |
| `src/lib/ingest/` | File parsers and the import service |
| `src/lib/pipeline/` | The refine pipeline, its job runner and the reconciler |
| `src/lib/agent/` | The agent, its tools and tracing |
| `src/lib/chat/` | Chunking, search and answers for chat |
| `scripts/worker.ts` | Worker entry point |
| `prisma/` | Schema, migrations, seed script and seed data |
| `docs/` | These docs |

## Design choices

**One queue item per article.** A job with 50 articles makes 50 queue items. A crash loses one article, not the run.

**One article at a time.** The local model is the slow part. More parallel work only makes it thrash.

**Work can be taken over.** A worker claims an item atomically and sends heartbeats. A cron job returns abandoned items to the queue. Every stage is safe to run twice. See `pipeline.md`.

**Status lives on the job item.** Each article has its own status row. The UI reads that row to show live progress. The job row holds only a coarse state.

**Content is append-only.** Each run writes new snapshots. Old ones stay. You can compare any two runs.

**Prompts are data.** They live in the `PromptTemplate` table. You can change a prompt without a deploy.

## What changed from the ServiceNow version

| ServiceNow | Here |
|---|---|
| Now Assist skill, async callbacks | Direct Ollama call inside the worker |
| Batched `executionRequests` | One article at a time |
| AMB record watchers | Not built. Plan: polling or SSE |
| `kb_knowledge`, `incident` tables | `Article`, `Incident` tables |
| Choice fields | Prisma enums |
| ACLs and roles | Accounts with two roles, `user` and `admin`. See `auth.md`. |
