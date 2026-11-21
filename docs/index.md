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
| [pages.md](pages.md) | What each page shows. |
| [chat.md](chat.md) | Compare answers from original and refined docs. |

## Status

| Area | State |
|---|---|
| Database schema | Done |
| Seed data | Done |
| Bulk upload (MD, HTML, TXT, CSV, JSON) | Done |
| Pipeline and worker | Done, tested on one article |
| Jobs API | Done |
| Pages: home, jobs, job detail, report | Done. Not checked in a browser. |
| Integrations page and scheduled pulls | Done. Tested with a local feed. |
| Chat comparison (original vs refined) | Done. Tested on seed data only. |
| Eval scorer | Not built |

## Origin

This app is a port of a ServiceNow AIUX app. The ServiceNow version used Now Assist for the LLM and ServiceNow tables for storage. This version uses Ollama and Postgres. The stages and the scoring rubric are the same.
