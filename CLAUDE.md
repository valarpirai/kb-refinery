# KB Refinery

Finds what is wrong with knowledge base articles and rewrites them for AI use. Next.js 15, Tailwind 4, Prisma 6, PostgreSQL, pg-boss, Ollama.

Docs are in `docs/`. Start at `docs/index.md`.

## Rules

- Use pnpm for everything. Never npm or yarn.
- Two processes run the app: `pnpm dev` (web) and `pnpm worker` (pipeline and scheduled pulls). Pipeline and pull changes need the worker restarted. It does not hot reload.
- The web server never calls the LLM. Only the worker does.
- Schema lives in `prisma/schema.prisma`. After editing it, run `pnpm db:migrate`.
- Prompts are rows in `PromptTemplate`, seeded from `prisma/seed/prompts/*.md`. Edit the file, then run `pnpm db:seed`.
- Check types with `pnpm exec tsc --noEmit` and lint with `pnpm lint` before committing.
- Keep each doc under 250 lines. Split instead of growing one.

## Origin

Ported from a ServiceNow AIUX app. That code is in git history on `main`. Chat, ask and the eval scorer were not ported.
