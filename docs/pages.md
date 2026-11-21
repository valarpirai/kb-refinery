# Pages

This is what each page shows and where its code lives.

| Route | Shows | Code |
|---|---|---|
| `/` | Summary tiles, recent articles, products mentioned, the Refine articles button | `src/app/(app)/page.tsx` |
| `/jobs` | Every job, newest first | `src/app/(app)/jobs/page.tsx` |
| `/jobs/[id]` | One job, live. Progress bar, count per status, one row per article. | `src/components/job-progress.tsx` |
| `/analysis/[id]` | One article's report | `src/app/(app)/analysis/[id]/page.tsx` |
| `/chat` | Chat with the agent, or compare original and refined answers. Saved conversations. | `src/app/(app)/chat/page.tsx` |
| `/articles` | Every article: search, filter, sort, pages, inline tags, bulk refine | `src/app/(app)/articles/page.tsx` |
| `/articles/[id]` | Opens the article's analysis page (or a preview with a Refine button if it has none) | `src/app/(app)/articles/[id]/page.tsx` |
| `/traces` | Admin only. Agent traces with filters | `src/app/(app)/traces/page.tsx` |
| `/traces/[id]` | Admin only. One trace as a timeline | `src/app/(app)/traces/[traceId]/page.tsx` |
| `/login`, `/signup` | Sign in or create an account | `src/app/(auth)/` |
| `/import` | Upload form and import history | `src/app/(app)/import/page.tsx` |
| `/integrations` | Connect sources, set schedules, run now | `src/app/(app)/integrations/page.tsx` |

## Home

Four tiles: article count, open findings, average raw score, average rewritten score. The scores are the mechanical ones.

The Refine articles button opens a dialog. Search by title. Tick articles. Start. Or choose Refine all. The page then jumps to the job.

## Job page

The page starts with the data the server loaded. Then the browser asks `GET /api/jobs/[id]` every 3 seconds. It stops when the job reaches a final status. No websockets.

A job item row links to the article report once the analysis exists. A failed row shows its error.

## Report

Top to bottom:

1. Title, stage, audience, summary.
2. Score chart. Mechanical and model score at each stage, for the latest run.
3. Findings, grouped by severity. A finding shows its detail, any broken URL, the article it overlaps with, and the incidents that back it.
4. Products mentioned.
5. Content tabs: Original, Converted, Rewritten. Markdown is rendered. Original HTML shows as source text.

Cancelled findings are hidden. They belong to older runs.

## Safety

Markdown renders through `react-markdown`. It does not run raw HTML from the article. Original HTML is shown as plain text, never injected into the page.

## Articles

Search matches the title, the knowledge base and tag names. Filter by stage, knowledge base and tag. Sort by last update, title or score. Each row has a six-dot strip, one dot per pipeline step, each step in its own color, with a text summary for screen readers.

Tags: click a tag's × to remove it. Type in the add box and press Enter to add one. Tags are lowercase, 1 to 40 characters, up to 20 per article. Everyone shares one set of tags.

## The pipeline view

On every report, under the summary, a stepper shows the six steps: Imported, Convert, Analyze, Enrich, Rewrite, Ready. Each step has its own color. The step the worker is on has a pulsing ring, and the connector into it sweeps. The page checks for changes every 2 seconds while a run is active and stops when it ends.

If a step fails, it turns red and says Failed. A panel shows the full error, a **Restart from** button, and a menu to restart from an earlier step. The job page shows the same option on failed rows.

## Not built

- Version picker. The report always shows the latest run.
- Before-and-after diff. The tabs show each stage side by side in time, not line by line.
- Product word cloud. Products are a bar list.
- Version picker on the report. It always shows the latest run.
- Finding actions. You cannot yet mark a finding acknowledged or remediated.
- Visual check in a real browser. Pages are tested for render and content only.
