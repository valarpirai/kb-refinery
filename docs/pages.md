# Pages

This is what each page shows and where its code lives.

| Route | Shows | Code |
|---|---|---|
| `/` | Summary tiles, recent articles, products mentioned, the Refine articles button | `src/app/page.tsx` |
| `/jobs` | Every job, newest first | `src/app/jobs/page.tsx` |
| `/jobs/[id]` | One job, live. Progress bar, count per status, one row per article. | `src/components/job-progress.tsx` |
| `/analysis/[id]` | One article's report | `src/app/analysis/[id]/page.tsx` |
| `/import` | Upload form and import history | `src/app/import/page.tsx` |
| `/integrations` | Connect sources, set schedules, run now | `src/app/integrations/page.tsx` |

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

## Not built

- Version picker. The report always shows the latest run.
- Before-and-after diff. The tabs show each stage side by side in time, not line by line.
- Product word cloud. Products are a bar list.
- Finding actions. You cannot yet mark a finding acknowledged or remediated.
- Visual check in a real browser. Pages are tested for render and content only.
