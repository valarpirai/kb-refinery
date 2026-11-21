# Pipeline metrics

This is how you see where refining spends its time.

## What it shows

**Pipeline metrics** in the top bar. Pick a range: 24 hours, 7 days, 30 days or all time.

- Tiles: articles processed, average time per article, total time, and the stage that costs most.
- **Where the time goes**: one bar split by stage, then a table per stage with share, runs, average, median, slowest 5%, longest and failures.
- **Slowest articles**: the ten that took longest, with the stage that took longest for each. Click one to open it.

Stages are Convert, Analyze, Enrich, Rewrite and Index for chat. Analyze includes the duplicate check.

## How it is measured

The worker times each stage and saves one `StageRun` row: stage, start, duration, and ok or error. A failed stage is saved too, so failures count toward time spent.

A restart or a retry adds a new row. Nothing is overwritten, so you can see retries cost time.

A stage that stops because another worker took the item is not saved. That run did not finish the work.

Time is wall-clock time, so it includes waiting on the model. Times from before this feature have no rows.

## Where the code is

| File | Job |
|---|---|
| `src/lib/pipeline/run-article.ts` | `timed()` wraps each stage |
| `src/lib/pipeline/metrics.ts` | The queries |
| `src/app/(app)/metrics/page.tsx` | The page |

For the agent's own numbers, see **Agent usage** in `agent.md`.
