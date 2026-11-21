# KB Refinery (Next.js)

Finds what is wrong with knowledge base articles and rewrites them for AI use. Runs on a local LLM through Ollama.

Stack: Next.js 15, Tailwind 4, Prisma 6, PostgreSQL, pg-boss, Ollama. Package manager: pnpm.

```bash
pnpm install
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev        # web server and pipeline worker together
```

Full docs are in [docs/index.md](docs/index.md).
