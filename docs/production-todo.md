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
| 8 | Set up Vitest. Add the dev dependency, a `vitest.config.ts` with the `@` alias, and a `pnpm test` script. | S | repo root, `package.json` |
| 9 | Add tests for the pipeline stages. They must be safe to run twice, and nothing checks that. | L | `src/lib/pipeline` |
| 10 | Add CI. Run `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm test` on every push. | S | `.github/workflows` |
| 11 | Set security headers, including a content security policy. | S | `next.config.ts` |
| 12 | Add a health check route for the web server and the worker. | S | `src/app/api` |
| 13 | Add structured logs. Add alerts for failed jobs and a dead worker. | M | web and worker |
| 14 | Let chat embeddings use a provider other than Ollama. They stay on Ollama even when `LLM_PROVIDER` is `anthropic`. | M | `src/lib/chat/embed.ts` |

## Decide

- Where Ollama and Postgres with pgvector run in production.
- Whether production uses Ollama or the Claude API. The Claude API still needs Ollama for embeddings until item 14 is done.
- Backups and retention for the database and the traces.

## Already fine

- Every API route calls `getUser()`, except `/api/auth/*`, which Better Auth owns.
- Refine stages are safe to run twice.
- The reconciler restarts stages after a worker dies.
- `.env` is not in git.

## Not checked

This list came from a quick scan, not a full audit. Not looked at: input size limits on uploads, error pages, dependency audit, database indexes, and backup of traces.
