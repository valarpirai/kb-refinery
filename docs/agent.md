# The agent

This is what the KB Refinery agent is, what it can do, and how to watch it work.

## What it is

The agent is a Strands agent (the TypeScript SDK, `@strands-agents/sdk`). It runs on your local Ollama model through Ollama's OpenAI-compatible endpoint. It runs in the worker, never in the web server.

It is a small tool-using assistant, not a free-roaming one. It can only call the tools below.

## What it can do

| Tool | Does |
|---|---|
| `import_from_url` | Fetches a page and the pages it links to on the same site. Imports them as articles. |
| `start_refine` | Starts a refine job for an import or for article ids. Returns at once. |
| `restart_failed` | Queues articles whose latest run failed, from the stage that failed. Finds them itself. |
| `get_job_status` | Reports a job's status and the count per stage. |
| `get_stats` | Reports article counts, stages, failed articles with their titles, open findings, average scores, top products. |
| `search_articles` | Finds articles by title words. |

The code is in `src/lib/agent/tools.ts`. The list shown to people is in `src/lib/agent/catalog.ts`.

## Editing the agent

**Agents** in the top bar lists every agent. Open one to read it. Admins can edit it.

The prompt is made from parts: a role, rules, the tools you tick, and a note for each tool.

| Part | What it is |
|---|---|
| Role | Who the agent is. |
| Tool list | Built from the tools you tick. |
| Tool notes | One per tool. Shown only for ticked tools. |
| Rules | One per line. |

Untick a tool and it vanishes from the tool list and its note. The model never hears of it.

The page shows a **Prompt preview** that updates as you type, before you save. When you save, the server builds the full prompt from the parts and stores it in the `Agent` table (`prompt`). The worker reads that stored text on every message and does not build it again. A saved change applies to the next message. No restart.

The prompt has no date. A stored prompt cannot keep one correct.

The first copy comes from `prisma/seed/agents/*.md`. `pnpm db:seed` creates an agent that is missing. It never overwrites one that exists, so your edits survive a re-seed. To go back to the shipped copy, delete the row and seed again.

The builder is `src/lib/agent/prompt.ts`.

## How you use it

### In chat

Open Chat. The default mode is **Agent**. Ask in plain words:

- "Import the docs from https://example.com/help and refine them."
- "How many articles are refined, and what is the average quality score?"
- "Which articles have open findings?"

Text streams in as the agent works. Each tool call shows as a row you can open to see its input and output.

### From an upload or a pull

Upload articles with **Let the agent refine these for me** ticked (the default). A scheduled pull that finds new or changed articles does the same. The system opens a chat conversation titled "Upload: …" or "Pull: …" and gives the agent the import. The agent starts the refine job.

When the job ends, you get a notification. See `notifications.md`.

## Limits worth knowing

- The agent never waits for refining. A job takes minutes. The agent starts it and says you will be told.
- It runs on a 4B model. It follows simple tool flows well. It can write a loose summary. Check numbers against the Home page when it matters.
- Crawling is polite and small: same site only, up to 50 pages, one request at a time. The server fetches any URL you give it, including addresses on your network. Only people you trust should have an account.
- A crawl reads pages as HTML. Pages built by JavaScript in the browser come back mostly empty.

## Agent usage

**Agent usage** in the top bar (`/agent-usage`) shows how much the agent runs. Pick a time range: 24 hours, 7 days, 30 days or all time.

- Tiles: runs, success rate, tool calls with the error share, average run time and total tokens.
- Runs per day.
- Per tool: calls, errors and average time.

Admins see everyone's chats. Other users see their own. Counts come from the saved chat replies. Tokens and run time come from the stored traces. Code: `src/lib/agent/usage.ts` and `src/app/(app)/agent-usage/page.tsx`.

## Traces

Every agent run is traced with Traceloop (OpenLLMetry). A trace shows each model call, each tool call, the time and the tokens.

### Where traces go

By default, only into your own Postgres, in the `TraceSpan` table. Nothing leaves your machine.

To also send them to Traceloop Cloud, set `TRACELOOP_API_KEY`. To send them to another OpenTelemetry backend, also set `TRACELOOP_BASE_URL`. Without the key, no export happens.

### Where to look

Admins see **Traces** in the top bar.

- The list shows agent runs, newest first. Filter by time, status, tool used, minimum time and text in prompts or answers. "All traces" adds queue and worker spans.
- **Span time by kind** shows p50, p90, p95 and p99 for each kind of span in the chosen time range. The other filters do not change it.
- Open a trace for a timeline. Each span has a colored kind: agent run, loop cycle, model call, tool call, chat request, worker. Open a span to read the prompt, the answer or the tool input.
- In chat, an agent reply shows **View trace** when you are an admin.

### How it works

`initTracing()` runs once when the worker starts. It starts Traceloop with a custom exporter that writes spans to Postgres (`src/lib/agent/trace-store.ts`). Strands emits its spans through the global OpenTelemetry API, and Traceloop collects them. Traceloop's own OpenAI instrumentation is off, because Strands already records model calls and the extra spans only duplicated them.

Long prompts are cut to 8,000 characters per attribute before saving.

## Where the code is

| File | Job |
|---|---|
| `src/lib/agent/run.ts` | Runs the agent and streams its progress into the database |
| `src/lib/agent/tools.ts` | The tools |
| `src/lib/agent/catalog.ts` | The tool list shown to people |
| `src/lib/agent/prompt.ts` | Builds the prompt from the parts. Used on save and in the preview |
| `src/app/(app)/agents/` | The agent list and the edit page |
| `src/app/api/agents/[slug]/route.ts` | Save an edit. Admins only |
| `prisma/seed/agents/*.md` | The first copy of each agent |
| `src/lib/agent/crawl.ts` | The site crawler |
| `src/lib/agent/start.ts` | Adds a message and queues the agent |
| `src/lib/agent/tracing.ts` | Starts Traceloop |
| `src/lib/agent/trace-store.ts` | Saves spans to Postgres |
| `src/app/api/agent/messages/` | Send a message, poll a reply |
