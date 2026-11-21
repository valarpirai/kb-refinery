# KB Refinery

Finds what is wrong with knowledge base articles and rewrites them for AI use. Next.js 15, Tailwind 4, Prisma 6, PostgreSQL, pg-boss, Ollama.

Docs are in `docs/`. Start at `docs/index.md`.

## Rules

- Use pnpm for everything. Never npm or yarn.
- `pnpm dev` runs two processes with concurrently: the web server (`pnpm dev:web`) and the worker (`pnpm worker`, pipeline and scheduled pulls). The worker does not hot reload, so restart `pnpm dev` after pipeline or pull changes.
- The web server never calls the LLM. Only the worker does. The agent (Strands) runs in the worker; traces go to Postgres via Traceloop.
- Every API route must call `getUser()` and return `unauthorized()` when there is no session. Pages live under `src/app/(app)`, which requires a session.
- Refine stages must stay safe to run twice. The reconciler re-runs stages after a worker dies. See `docs/pipeline.md`.
- After a schema change, restart `pnpm dev`. A running server keeps the old Prisma client.
- Schema lives in `prisma/schema.prisma`. After editing it, run `pnpm db:migrate`.
- Prompts are rows in `PromptTemplate`, seeded from `prisma/seed/prompts/*.md`. Edit the file, then run `pnpm db:seed`.
- Check types with `pnpm exec tsc --noEmit` and lint with `pnpm lint` before committing.
- Keep each doc under 250 lines. Split instead of growing one.

## Origin

Ported from a ServiceNow AIUX app. That code is in git history on `main`. Chat, ask and the eval scorer were not ported.
