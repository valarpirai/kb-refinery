# Pipeline

This is what happens to an article after you start a job.

## Starting a job

`POST /api/jobs` creates a `Job` and one `JobItem` per article. It puts one queue item per article on the `refine-article` queue. The worker takes them one at a time.

The code is in `src/lib/pipeline/jobs.ts`. The worker is `scripts/worker.ts`.

## The stages

`run-article.ts` runs these in order. Each stage updates the job item status, so the UI can show where an article is.

| # | Stage | Job item status | What it does |
|---|---|---|---|
| 1 | Convert | `converting` | Save the raw snapshot. Convert HTML to Markdown with Turndown. Save the converted snapshot. Score both. |
| 2 | Analyze | `analyzing` | Ask the model for findings, summary, audience, search terms and products. Score the raw text too. Check for duplicates. |
| 3 | Enrich | `enriching` | Only if a finding is a content gap. Find incidents that match the search terms. Ask the model what they add. |
| 4 | Rewrite | `scoring` | Only if there are findings. Ask the model to rewrite the article. Save the enriched snapshot. Score it. |

An article with no findings finishes after stage 2.

An article that has not changed since its last run is skipped.

## The LLM calls

Every call uses a prompt from `PromptTemplate`. The same analysis prompt scores raw, converted and enriched text. That keeps the three scores comparable.

| Call | Prompt | Thinking |
|---|---|---|
| Analysis | `kb_article_analysis` | off |
| Score only (raw, enriched) | `kb_article_analysis` | off |
| Duplicate check | `duplicate_confirmation` | off |
| Enrichment | `incident_enrichment` | on |
| Rewrite | `article_synthesis` | on |

Thinking helps most on enrichment and rewrite. It is also slow. In a test, one trivial call took 63 seconds with thinking and 1 second without. So thinking is off elsewhere.

Set `OLLAMA_THINK=always` or `never` to override.

## Getting clean JSON

`ollama.ts` sends a JSON schema with every call. Ollama then forces valid JSON. The reply is checked against a zod schema in `schemas.ts`. On failure the call retries once. Then the item fails.

The schemas are forgiving. A null becomes an empty string. An unknown finding type becomes `incomplete`. A small model makes these slips often.

## Findings that trigger enrichment

These types mean content is missing: `incomplete`, `no_resolution_steps`, `missing_prerequisites`, `no_error_guidance`, `outdated`, `missing_context`.

Other types, like structure problems, go straight to the rewrite. Incidents cannot fix those.

## Duplicates

After analysis, the new article is compared with others in the same job. Articles that share a search term are candidates. At most three are checked. The model decides if they cover the same topic. A match adds a `duplicate` finding to both articles.

## Failure

Any error is caught. The job item becomes `failed` with the message. The analysis stage becomes `failed`. The rest of the job continues. When every item is done, the job gets its final status.

## Known gaps

- **Link checking is not done.** The old app checked internal KB links against the instance. Here the scorer assumes every link works. Broken links come only from the model.
- **Scores on short text.** Under 25 words, the mechanical score is empty.
- **Low LLM scores on one test.** On a 17-word article, the raw and converted LLM scores came back 0 while the rewrite scored 95. Not yet checked. It may be the model judging a tiny article harshly. Test with real-length articles before trusting it.
- **Speed is untested at scale.** Only one short article has run end to end.
- **No retry for a crashed worker mid-article.** The queue will retry the item. The stages are not idempotent, so a retry may add duplicate findings.
