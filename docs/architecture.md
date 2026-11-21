# Architecture

High-level shape of the app: what exists, what it's built with, and how the pieces are meant to fit together. See `plan.md` for the problem/why and `tables.md` for the full schema.

## Stack

- **Frontend**: ServiceNow AIUX (`@servicenow/aiux`) — Lit 3 web components, Tailwind + DaisyUI, server-rendered pages under `pages/`.
- **Backend metadata**: ServiceNow SDK (`@servicenow/sdk` 4.11.2) Fluent — `.now.ts` files under `src/fluent/` define tables, forms, and (eventually) business rules/script includes as code, built via `now-sdk build` and installed via `now-sdk install`.
- **Scope**: `x_snc_kb_refinery`, instance `https://surfuat2.service-now.com` (see `plan.md`).

## Two layers, built in the opposite order from how they'll run

1. **Frontend shell** (built first, as of this writing): `pages/home`, `pages/pipeline`, `pages/job-tracker`, `pages/analysis-report/[sysId]`. Originally all hardcoded demo data — no table reads/writes. All wired to real data now, each via the same live-AMB-record-watcher pattern (no polling anywhere). (A `pages/incidents` page — an `aiux-list-connected` list of active incidents — was part of the original shell and was deleted 2026-09-02; it was a leftover scaffold demo, unrelated to the refinery's own data.)
   - `pages/job-tracker` — via its two widgets' server scripts (`GlideRecordSecure`).
   - `pages/home` — a current-job status rail (`pages/home/current-job.js`, client-side REST Table API) whose position is derived from real per-article Job Item counts (`fetchJobItemCounts`), not a single `Job.status` phase — `Job.status` itself is coarse now (`pending`/`running`/`completed`/`completed_with_errors`/`failed`, see below) — plus a focal "Refine articles" button (`widgets/pipeline-run-launcher`) that opens a KB-article search/multi-select picker — filtered to each article's current version only (`kb_knowledge.latest`, not `workflow_state`, so a superseded older version never shows up alongside its current one) — and starts a real run scoped to just the picked article(s), then navigates straight to `/pipeline` to watch it — the first real caller of `RefineryOrchestrator.run()` (previously unreachable — see below). See `.claude/rules/kb-refinery-widgets.md`/`kb-refinery-pages.md` for the implementation notes. Its "Articles" table is now real too (`pages/home/analysis-list.js` — the 10 most-recently-updated Analysis records, joined against latest-per-type Snapshot scores), each row linking to the new per-article report page below. Also new (2026-09-03): `widgets/product-word-cloud`, a Highcharts word cloud of `x_snc_kb_refinery_product` sized by `article_count` — the first real consumer of that field's "fast dashboard tiles" design intent (see `tables.md`). See `.claude/rules/kb-refinery-widgets.md` for the implementation notes (the Highcharts-module dynamic-import pattern, the `highcharts` dependency pin, forced-colors handling).
   - `pages/pipeline` — the stats, per-stage/exit counts, mechanical-score averages, and the article list at the bottom (`pages/pipeline/pipeline-data.js`) are real, using a third stage-naming scheme (`ingested/converted/analyzed/enriching/synthesizing/ready` plus three exits). As of 2026-09-03 the tunnel's per-stage detail is real too, not static UI copy: an article selector (`<pipeline-tunnel>`'s `articles`/`selectedArticleId` props, scoped to the current job) picks one real article, and `page.js`'s `_stages()` builds each stage's `desc`/`example` from that article's own real Snapshot content/scores, Findings, matched-incident Evidence, and `enrichment_knowledge` (`pipeline-data.js`'s new `fetchArticleDetail()`) — `example` is `null` with an explicit `emptyMessage` when the article hasn't reached that stage yet, rather than falling back to fabricated content. As of 2026-09-03 this buckets primarily off real `x_snc_kb_refinery_job_item.status` (one row per article, real-time, per-job) rather than a `Job.status` approximation — only the `ready`-vs-`no_gaps` and `failed`-vs-`no_evidence` distinctions still need an overlay check (`Analysis.pipeline_stage`/`enrichment_knowledge`), since a Job Item's `completed`/`failed` status alone can't tell those apart — see `.claude/rules/kb-refinery-domain.md`. ~~The page's `article-diff-dialog` before/after comparison is still hardcoded demo content~~ — resolved differently than originally planned: clicking an article now navigates to the new per-article report page below instead of opening that dialog, which is unwired (left in place, unused — see `.claude/rules/kb-refinery-pages.md`) rather than fixed in place.
   - `pages/analysis-report/[sysId]` (new, 2026-09-02) — a full per-article report, keyed by the Analysis record's own sys_id: every Analysis field, per-stage (raw/converted/enriched) Snapshot scores/counters side by side, Findings (grouped by severity, with Evidence for duplicate/broken-link types), and Product Mentions. Includes a side-by-side content viewer (`components/analysis-content-viewer.js`) — not a diff view (descoped mid-build) but a real rendered (markdown→HTML, sanitized) view of any 1–3 of the three content stages at once. See `.claude/rules/kb-refinery-pages.md` for the implementation technique notes (dot-walked-field/`sysparm_display_value=all` gotchas, the two-phase snapshot fetch, client-only `marked`/`dompurify` rendering).
2. **Data model**: the 8 pipeline tables in `tables.md` — `analysis`, `snapshot`, `finding`, `evidence`, `product`, `mention`, `job`, `job_item` (added 2026-09-03) — plus `prompt_template` (data, not pipeline state).
3. **Pipeline job**: an async, batched, callback-driven state machine, not one long synchronous
   run — and, as of 2026-09-03, not one whole-job phase either. `RefineryOrchestrator` creates one
   `x_snc_kb_refinery_job_item` per article up front, splits them into batches of
   `LLM_BATCH_SIZE`, and runs each batch's converting→analyzing→enriching→scoring pipeline
   independently, so different batches (and articles) genuinely progress at different rates.
   `Job.status` is coarse (`pending`/`running`/`completed`/`completed_with_errors`/`failed`); the
   real per-article phase lives on `Job Item.status` instead. `RefineryLLM` builds and sends one
   batched `executionRequests` call per dispatch; `RefineryLLMCallback` receives results later and
   either dispatches that item's next stage or marks it terminal — every callback handler and
   dispatch step is isolated per-item so one failure can't strand the rest of its batch (see
   `.claude/rules/kb-refinery-domain.md`). Plus `RefineryPromptTemplate`, `RefineryIncidentSearch`,
   `HTMLToMarkdownLib` (conversion, already verified working before this pass), `RefineryJsonUtil`
   (local JSON-fence-stripping helper the callback uses to parse a reply — a deliberate local copy
   of the platform's own AIGC parsing convention rather than a cross-scope call, see
   `.claude/rules/kb-refinery-domain.md`), and the instance-side `AIReadabilityScorer` (mechanical
   scoring). See `plan.md`'s Pipeline Overview and LLM Calls sections for the full phase-by-phase
   design.

The Now Assist Skill `RefineryLLM` calls (`c2b82f393b8f83106479ff7e53e45aa0` /
`a2b8af393b8f83106479ff7e53e45ad3`, see `plan.md`'s Status section) is now wired in, and
`RefineryOrchestrator.run()` now has a real caller (`widgets/pipeline-run-launcher`, see above) —
no scheduled job exists yet, but a manual run is a real, working entry point. What's still missing:
a live end-to-end run actually exercised against `surfuat2` — the `pages/analysis-report/[sysId]`
page, `pages/home`'s article list, its new `product-word-cloud` widget, and the pipeline-page
navigation into it are all verified via `now-sdk build`/lint only so far, not yet confirmed against
real instance data in a browser.

## Data flow

```
kb_knowledge
        │  (source_table + source_record, polymorphic)
        ▼
   Analysis (1 row per article, current pipeline_stage)
        │
        ├──► Content Snapshot (append-only: raw / converted / enriched × every run)
        │        — score (mechanical, AIReadabilityScorer) + llm_score (LLM's own rubric),
        │          tracked side by side rather than conflated — see plan.md's Re-scoring Pass
        │
        ├──► Finding (quality issues; duplicate findings cross-reference another Analysis row)
        │        └──► Evidence ──► incident (resolved tickets that support a finding,
        │                          found via RefineryIncidentSearch)
        │
        └──► Mention ──► Product Index (cross-article product/gap detection)

   Job — one row per pipeline run; Analysis/Snapshot/Finding rows denormalize `last_job`.
   `status` is coarse (pending/running/completed/completed_with_errors/failed) as of 2026-09-03.

   Job Item — one row per (job, article), including a `skipped` one for an unchanged article.
   Real-time per-article `status` (pending/converting/analyzing/enriching/scoring/completed/
   failed/skipped) — this is what actually tracks progress through the async batches now,
   not a field on Job — see tables.md.

   Prompt Template — not part of this flow; a static lookup table RefineryPromptTemplate.render()
   reads from, independent of any one run.
```

## Why Content Snapshot is a separate, append-only table

The plan originally called for `content_raw`/`content_converted`/`content_enriched` and their three matching scores as six fields directly on Analysis, overwritten on every rerun. Splitting them into a child table with a `type` discriminator and never overwriting rows (see `tables.md`) does two things at once: it keeps Analysis to genuinely per-article state, and it gives real run-over-run version history for free — every rerun just adds three more rows, rather than needing a separate versioning mechanism, which the original plan had flagged as an open "good to have."

**"Current" needs the explicit `version` field, not just `ORDERBYDESC processed_at` per type.** The initial cut of this table had no `version` column — "current" was computed by independently taking the latest row per `(parent, type)`. That's insufficient on its own: if a run's enrichment fails (no `enriched` row written for that run — see `RefineryOrchestrator._handleEnrichingResult`'s skip branch, which does still write an empty message-only row, but a genuinely dropped run wouldn't), reducing each type independently can pull that run's `raw`/`converted` together with an *older* run's `enriched` row, with nothing to signal they're not actually from the same run. `version` (an Integer — the run number, 1/2/3/...) fixes this: every row from one run shares the same `version`, so a consumer that wants "this run's trio" filters by an exact `version` match rather than reducing per type. See `tables.md`'s Content Snapshot section and `pages/analysis-report/[sysId]/analysis-report-data.js`.

## Why polymorphic source references use `DocumentIdColumn`, not a plain string

Articles can live in `kb_knowledge` or `kb_knowledge_block` (and potentially other KB-extending tables). Rather than two plain string fields (`source_table` + `source_sys_id`), Analysis uses the SDK's native `TableNameColumn` + `DocumentIdColumn({dependent: 'source_table'})` pair — the platform's own pattern for a field that references a record in a dynamically-determined table (the same shape `sys_attachment` uses internally). See `.claude/rules/environment-build-deploy.md` for where this is documented in the SDK's own type definitions.

## Deliberately out of scope for this pass

- No related lists on the native form (child records won't show up under a parent record's form yet).
- No scheduled/automatic caller for `RefineryOrchestrator.run()` — only the manual button exists so far.
- No verified end-to-end run against a real instance — `RefineryOrchestrator`/`RefineryLLMCallback` have been through `now-sdk build`/lint, not a live pipeline run yet. Same caveat applies to `pages/analysis-report/[sysId]` (new, 2026-09-02) — build/lint-clean, not yet opened against real instance data in a browser (the dev server proxies to a real login, which wasn't available to verify this from an agent session).
- Whether `RefineryLLMCallback` needs `accessibleFrom: 'public'` to be reachable from the async dispatcher — left unset (the more restrictive default) until proven otherwise (see `.claude/rules/kb-refinery-domain.md`).

Each of these is a reasonable next slice of work, not an oversight — see `plan.md` for what's next.
