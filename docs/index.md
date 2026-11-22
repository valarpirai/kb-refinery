# KB Refinery docs

KB Refinery reads knowledge base articles, finds what is wrong with them, and rewrites them so an AI agent can use them. A local LLM does the work. Nothing leaves your machine.

## Read in this order

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | The parts, and how they fit. Start here. |
| [running.md](running.md) | Setup and daily commands. All commands use pnpm. |
| [data-model.md](data-model.md) | Every table and what it holds. |
| [ingestion.md](ingestion.md) | How articles and incidents get in. |
| [pipeline.md](pipeline.md) | The stages, the LLM calls, and the queue. |
| [metrics.md](metrics.md) | How long each refine stage takes. |
| [scoring.md](scoring.md) | The AI-ready score: five criteria, two scorers, three stages. |
| [pages.md](pages.md) | What each page shows. |
| [agent.md](agent.md) | The agent, its tools, and its traces. |
| [chat.md](chat.md) | Chat: talk to the agent, or compare original and refined docs. |
| [auth.md](auth.md) | Login, roles, the default admin. |
| [notifications.md](notifications.md) | The bell and toasts. |
| [live-updates.md](live-updates.md) | How pages update without a reload. |
| [production-todo.md](production-todo.md) | What is left before real users. |

## Status

| Area | State |
|---|---|
| Database schema | Done |
| Seed data | Done |
| Bulk upload (MD, HTML, TXT, CSV, JSON) | Done |
| Pipeline and worker | Done, tested on one article |
| Jobs API | Done |
| Login, roles, default admin | Done |
| Pages: home, articles, jobs, job detail, report, chat, traces | Done. Not checked in a browser. |
| Pipeline view with restart from a failed stage | Done. Animation not seen. |
| Heartbeats and recovery of stuck jobs | Done |
| Agent (Strands) with Traceloop traces | Done |
| Notifications | Done |
| Tags on articles | Done |
| Integrations page and scheduled pulls | Done. Tested with a local feed. |
| Chat comparison (original vs refined) | Done. Tested on seed data only. |
| Eval scorer | Not built |

## Origin

This app is a port of a ServiceNow AIUX app. The ServiceNow version used Now Assist for the LLM and ServiceNow tables for storage. This version uses Ollama and Postgres. The stages and the scoring rubric are the same.
