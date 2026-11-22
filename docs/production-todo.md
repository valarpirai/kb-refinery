# Before production

This is what stands between KB Refinery and real users. Today it works as an internal tool or demo. It is not production ready.

Items are in the order to do them. Size is rough: S is under an hour, M is a day, L is more.

## Blockers

| # | Item | Size | Where |
|---|---|---|---|
| 1 | Read trusted origins from config. They are hardcoded to localhost. Login breaks on a real domain. | S | `src/lib/auth.ts` |
| 2 | Set `ALLOW_SIGNUP` to false by default. Anyone can create an account today. | S | `.env.example`, `docs/auth.md` |
| 3 | Refuse to boot in production with the default admin password or a placeholder auth secret. | S | `prisma/seed.ts`, `src/lib/auth.ts` |
| 4 | Block internal addresses in connectors. Users set the URL, and the server fetches it. Reject loopback, private ranges and cloud metadata addresses. Check after redirects. | M | `src/lib/ingest`, sources API |
| 5 | Rate limit the API and the login route. | M | `src/app/api`, `/api/auth` |
| 6 | Run the web server and the worker as separate processes. Add a Dockerfile and a compose file. | M | repo root |
| 7 | Add `prisma migrate deploy` as a script. `db:migrate` runs `migrate dev`, which is for development only. | S | `package.json` |

## Needed soon

| # | Item | Size | Where |
|---|---|---|---|
| 8 | Add CI. Run `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm test` on every push. | S | `.github/workflows` |
| 9 | Set security headers, including a content security policy. | S | `next.config.ts` |
| 10 | Add a health check route for the web server and the worker. | S | `src/app/api` |
| 11 | Add structured logs. Add alerts for failed jobs and a dead worker. | M | web and worker |
| 12 | Let chat embeddings use a provider other than Ollama. They stay on Ollama even when `LLM_PROVIDER` is `anthropic`. | M | `src/lib/chat/embed.ts` |

## Search and indexing

Chat search keeps one row per chunk in `Chunk`. The `embedding` column is `vector(768)`, from pgvector. Search mixes a vector match with a keyword match. See `chat.md`.

| # | Item | Size | Where |
|---|---|---|---|
| 13 | Add a vector index. Today there is none, so each question scans every chunk. That is exact and fine for a few thousand chunks. Past about 10,000, add an HNSW index with `vector_cosine_ops`. | M | new migration |
| 14 | Fix filtered search. The query filters by variant, stage and tag. An HNSW index applies filters after it picks candidates, so a narrow filter can return too few rows. Turn on pgvector iterative scan (0.8 and later), or use one partial index per variant. | M | `src/lib/chat/retrieve.ts` |
| 15 | Keep the index out of Prisma's way. Prisma cannot model HNSW, and it does not know the GIN index on `to_tsvector`. Write both in migration SQL and check that `prisma migrate diff` stays clean. | S | `prisma/migrations` |
| 16 | Pin the embedding model. The column size is fixed at 768, and nothing records which model made a vector. A new model means a migration and a full reindex. Store the model name on each chunk, and refuse to mix models in one search. | M | `Chunk`, `embed.ts` |
| 17 | Make indexing cheaper. Each run deletes every chunk of the article and inserts them one row at a time. Skip an article when its text is unchanged (store a hash). Insert in one batch. `indexAll` runs one article at a time. | M | `src/lib/chat/indexer.ts` |
| 18 | Track index failures. When indexing fails, the article still shows as ready and chat cannot find it. Only a warning is logged. Record an index status, retry it, and alert on it. | M | `run-article.ts`, `Analysis` |
| 19 | Plan the extension. `CREATE EXTENSION vector` needs a role that may create it, and a Postgres host that ships pgvector. The shadow database needs it too. Write this into `running.md`. | S | `docs/running.md` |
| 20 | Re-check the score cutoff. `MIN_SCORE` is 0.6, tuned for `nomic-embed-text`. Test it again for any new model. Add a small set of known questions to check recall. | S | `retrieve.ts` |
| 21 | Plan index upkeep. Run `ANALYZE` after a bulk reindex. Watch the size of the `Chunk` table and its indexes. | S | ops |
| 22 | Widen keyword search. It uses the English text config only. Other languages match poorly. | S | `retrieve.ts`, migration |

## Decide

- Where Ollama and Postgres with pgvector run in production.
- Whether production uses Ollama or the Claude API. The Claude API still needs Ollama for embeddings until item 12 is done.
- Backups and retention for the database and the traces.

## Done

- Vitest is set up. `pnpm test` runs it.
- Unit tests cover the lib modules, every API route except Better Auth's, and every component. Stage idempotency and the reconciler are tested.
- Bugs the tests found are fixed: the tag limit check, `formatDuration`, a failed pg-boss start that was cached forever, and missing `fetch` error handling in four components.

## Already fine

- Every API route calls `getUser()`, except `/api/auth/*`, which Better Auth owns.
- Refine stages are safe to run twice.
- The reconciler restarts stages after a worker dies.
- `.env` is not in git.

## Not checked

This list came from a quick scan, not a full audit. Not looked at: input size limits on uploads, error pages, dependency audit, backup of traces, and indexes outside `Chunk`.
