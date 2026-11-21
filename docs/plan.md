# **Knowledge Refinery — Hackathon Plan**

- **Hackathon:** CREATE 2026  
- **Team:** Knowledge Refinery  
- **Problem:** KB articles built for humans, not agents — missing, outdated, incomplete. Evidence to fix them exists in closed cases/resolved tickets.
- **Instance:** https://surfuat2.service-now.com

This is the living plan — update it as decisions get made. See `architecture.md` for how the pieces fit together, `tables.md` for the full current schema, and `security.md` for the ACL/data-sensitivity punch list.

---

## Status

### Done

- **Frontend shell** — `pages/home`, `pages/pipeline`, `pages/job-tracker`, `pages/analysis-report/[sysId]`. Originally UI-only, hardcoded demo data. (A scaffold-leftover `pages/incidents` list page was deleted 2026-09-02.) `pages/home` has a current-job status rail (`current-job.js`) reading the real `x_snc_kb_refinery_job` table (same live-AMB pattern as Job Tracker below), plus a focal "Refine articles" button (`widgets/pipeline-run-launcher`) that opens a KB-article picker — filtered to each article's current version only, not by `workflow_state` — and starts a real run scoped to just the picked article(s), then navigates straight to `/pipeline` to watch it (see the 2026-09-03 entry below) — the first real caller of `RefineryOrchestrator.run()`; its own "Articles" table is real now too (`analysis-list.js`), linking into the new per-article report page below. `pages/pipeline` now reads real data for its stats/stage-and-exit counts/article list (`pipeline-data.js`, same live-AMB pattern). As of 2026-09-03 the tunnel's per-stage detail is real too: an article selector (scoped to the current job) picks one real article, and every stage's `desc`/example is either that article's own real content/output at that step (raw/converted/enriched Snapshot content, real Findings, real matched-incident Evidence, real `enrichment_knowledge`) or an explicit empty state when that article hasn't reached the stage yet — no more fabricated printer-troubleshooting demo copy. ~~its `article-diff-dialog` before/after comparison is still hardcoded demo prose~~ — resolved differently: clicking an article now opens the new `pages/analysis-report/[sysId]` report page instead (see below), not that dialog (left in place, unwired, in case its visual scaffold is useful for a real diff view later — see `architecture.md`'s Frontend shell note for the stage-bucketing approximation this involved).
- **Job Tracker page** (`pages/job-tracker`) — implements this doc's "Overview Dashboard" job-status bullet below, but wired to the real `x_snc_kb_refinery_job` table from the start (not hardcoded demo data like the rest of the frontend shell above). Two widgets: `job-list-panel` (selectable job list) and `job-progress-tracker` (the selected job's live stage/counts, pushed via the platform's built-in AMB record watcher — no custom pub/sub needed, see `.claude/rules/kb-refinery-domain.md`). Only the `converting` phase (and phase-entry into `analyzing`) will show real progress on an actual run until the "Not started" `RefineryLLM` Skill placeholder below is filled in.
- **Data model** — 8 pipeline tables (7 original + `x_snc_kb_refinery_job_item`, added 2026-09-03) + `x_snc_kb_refinery_prompt_template` (9 total), built and verified against a real `now-sdk build` (see `tables.md`).
- **Access** — one role (`x_snc_kb_refinery.user`) with full CRUD ACLs on the 8 pipeline tables plus read-only on the prompt template table (see `security.md`). No user/group assignment yet, and still a single flat role rather than tiered.
- **The pipeline job** — built as an **async, batched, callback-driven state machine**, not one long synchronous run (see "Pipeline Overview" below):
  - `RefineryOrchestrator` — creates one `x_snc_kb_refinery_job_item` per article up front, batches them (`LLM_BATCH_SIZE` per batch), and runs each batch's converting→analyzing→enriching→scoring pipeline independently — different batches (and therefore different articles) genuinely progress at different rates. `Job.status` itself is coarse (`pending`/`running`/`completed`/`completed_with_errors`/`failed`); the real per-article phase lives on `Job Item.status` instead (see 2026-09-03 entry below).
  - `RefineryLLM` — batch dispatch.
  - `RefineryLLMCallback` — the async result handler.
  - `HTMLToMarkdownLib` — vendored `node-html-markdown`, confirmed working, for conversion.
  - `AIReadabilityScorer` — instance-side, for mechanical scoring.
  - `RefineryPromptTemplate` — renders the 4 LLM-backed prompts (see "LLM Calls" below — `kb_article_analysis` is dispatched 3 times per article, against raw/converted/enriched content, not 3 separate prompts; plus Call 2, Call 3, and the duplicate-confirmation call).

### Not started / not verified

- The layout-table/empty-`<div>` stripping heuristics in "HTML → Markdown Conversion" below aren't wired into the conversion step yet.
- Whether `RefineryLLMCallback` needs `accessibleFrom: 'public'` to actually be reachable — left unset/restrictive for now (see `.claude/rules/kb-refinery-domain.md`).
- A real end-to-end run against `surfuat2`, triggered via the new "Run pipeline on articles…" button, hasn't actually been exercised live yet — everything below this line is verified via `now-sdk build` only.
- `pages/analysis-report/[sysId]` (see the 2026-09-02 entry below) is build/lint-verified only — not yet opened in a browser against real instance data (the dev server proxies to a real SSO login unavailable from an agent session).

### Done (Analysis report page + real home/pipeline article lists, 2026-09-02)

- New page `pages/analysis-report/[sysId]/page.js` (route `/analysis-report/:sysId`) — a full per-article report: every Analysis field, the polymorphic source article's resolved title/number, per-stage (raw/converted/enriched) Snapshot scores/counters side by side, Findings grouped by severity (with Evidence for `duplicate`/`broken_link` types), and Product Mentions. `target_audience` gets its own labeled badge, cross-referenced with an "Audience mismatch flagged" badge when an `audience_mismatch` Finding exists, so the two aren't only discoverable by reading through the Findings list.
- `components/analysis-content-viewer.js` — a side-by-side viewer for the three content stages. Originally scoped as a computed word-diff (`diff`/jsdiff), then reconsidered mid-build: converted/enriched content is Markdown and raw is HTML, so diffing/highlighting raw source would show markdown syntax with strikethrough through it rather than a real "report." Landed instead as a plain picker (any 1–3 of raw/converted/enriched) rendering each as real HTML — markdown via `marked`, sanitized via `dompurify`, both dynamically imported client-only (see `.claude/rules/kb-refinery-pages.md`) — with no diff computation at all.
- `pages/pipeline/page.js`'s article-row click now navigates to the new report page instead of opening the old mocked `article-diff-dialog` (left in the repo, unwired — see `.claude/rules/kb-refinery-pages.md`).
- `pages/home/page.js`'s "Articles" table — previously hardcoded demo rows despite the rest of that page already being real (see `architecture.md`'s note on this) — is now `analysis-list.js`'s real recent-Analysis fetch, linking into the new report page.
- New dependencies: `marked`, `dompurify`.

### Done (Job Item real-time per-article status, 2026-09-03)

- The job page's status was confusing because `Job.status` forced every article in a run to
  appear to be at the same pipeline phase, when different articles genuinely finish at different
  points (one with no content-gap Finding is done after analyzing; one with a gap keeps going
  through enrichment/rewrite/rescoring). Replaced with a new table, `x_snc_kb_refinery_job_item` —
  one row per (job, article), including a `skipped` one for an unchanged article, with its own
  real-time `status`: `pending`/`converting`/`analyzing`/`enriching`/`scoring`/`completed`/
  `failed`/`skipped`. `scoring` covers both the rewrite call and the immediately-following
  re-score-of-the-rewrite call. See `tables.md` for the full field list.
- `Job.status` is coarse now: `pending`/`running`/`completed`/`completed_with_errors`/`failed`.
  `Job.pending_work`/`pending_batch_count`/`current_stage` are gone — no longer needed, since
  per-batch progress is queryable directly from real Job Item rows.
- `RefineryOrchestrator` rewritten around per-batch, per-item progression instead of a single
  whole-job phase state machine (see "Pipeline Overview" below for the new flow). Deduplication
  folds into the analyzing step as a side-channel rather than its own phase, and never gates an
  item's own status. Enrichment no longer gives up when zero incidents are found — the
  `incident_enrichment` prompt was rewritten to allow extraction from general domain/product
  knowledge, confidence-capped, rather than defaulting to "not extractable."
- Hardened so every Job Item is guaranteed to reach a terminal status even when something throws
  unexpectedly: each item's callback handling, batch dispatch, and conversion step are isolated in
  their own try/catch (one item's failure can't strand the rest of its batch), with layered
  fallbacks (`_recoverFromUnhandledError`, `_failRemainingItems`) at the callback, batch, and
  whole-job level. The one residual risk no code-level fix can close: the platform silently never
  sending any callback at all for a dispatched item — that would need a time-based sweep, and this
  app has no scheduling primitive (see `.claude/rules/kb-refinery-domain.md`).
- `widgets/job-progress-tracker`, `widgets/job-list-panel`, and `pages/pipeline` now group their
  counters by real Job Item status (server-side `GlideAggregate` in the widgets, client-side
  reduction in `pipeline-data.js`) instead of approximating from `Job.status`, with AMB watchers on
  the new table for real-time updates. `pages/home`'s rail was also rewired to a representative
  "leading edge" position derived from real Job Item counts.

### Done (Refine-articles picker: latest-version filter + auto-navigate to pipeline, 2026-09-03)

- `widgets/pipeline-run-launcher`'s article picker went through two quick
  revisions: a `workflow_state='published'` filter was added first (to stop
  showing draft/review articles), then replaced with a filter on
  `kb_knowledge.latest` instead — the real complaint was a revised article's
  **older versions** (separate `kb_knowledge` rows sharing one `number`)
  showing up alongside its current one, which `workflow_state` can't fix
  (a superseded version's own `workflow_state` is whatever it was left at,
  often still `published`). `latest` is a real, platform-maintained
  boolean that's exactly "is this the current version of this article,"
  independent of that version's own workflow state. See
  `.claude/rules/kb-refinery-widgets.md` for the full before/after.
- `pages/home/page.js` now navigates straight to `/pipeline` the instant a
  manual run starts, instead of just updating the home page's own rail —
  no job-id query param needed, since `/pipeline`'s own `fetchCurrentJob()`
  already resolves to "the most recent job," which the just-started run
  always is. See `.claude/rules/kb-refinery-pages.md`.

### Done (LLM wiring + manual run trigger + pipeline page real data, 2026-09-02)

- The Now Assist Skill `RefineryLLM` calls (`sn_nowassist_skill_config` "Knowledge Refinery", Claude Opus/Sonnet via Bedrock, scoped to the `x_snc_kb_refinery.user` role) now exists on the instance, and `src/fluent/script-includes/refineryLLM.server.js`'s `CAPABILITY_ID`/`SKILL_CONFIG_ID` are wired to the real, confirmed values (`c2b82f393b8f83106479ff7e53e45aa0` / `a2b8af393b8f83106479ff7e53e45ad3`) — no longer placeholders.
- JSON parsing now goes through a new local script include, `RefineryJsonUtil` (`safeJSONParse`/`stripResponseEnclosures`), instead of a hand-rolled regex — see `.claude/rules/kb-refinery-domain.md` for why this is a local copy rather than a cross-scope call, and for the behavior change (`safeJSONParse` never throws; `RefineryLLMCallback` now detects a parse failure by `typeof`, not by catching an exception).
- `RefineryLLM.dispatchBatch` now also accepts a `chatHistory` payload shape (unused by any real call site yet, but confirmed to work against this Skill) alongside the existing one-shot `promptText` shape — see `docs/examples/`.
- `RefineryOrchestrator.run()` now has a real caller: `widgets/pipeline-run-launcher` (button + KB-article picker on the home page). `run()`/`_runConvertingPhase()` take an optional `articleSysIds` array to scope a run to exactly the picked article(s) instead of the usual active/published/2-year batch query — same job-lock guard as a scheduled batch run (only one job in flight app-wide), and now also sets `Job.triggered_by` (previously never written by any code path).
- `pages/pipeline` reads real data (`pipeline-data.js`) for its top stats, per-stage/per-exit counts, mechanical-score averages, and article list, with the same live-AMB-record-watcher pattern `pages/home`/Job Tracker already use — see `.claude/rules/kb-refinery-domain.md` for the stage-bucketing approximation this needed (Job.status-driven, since `Analysis.pipeline_stage` alone can't distinguish most in-flight states).

---

## Wicked Problem

Every AI deployment ServiceNow touches runs into the same quiet bottleneck: the knowledge base that's supposed to power it was built for humans, not agents. Articles are missing, outdated, incomplete, or written for the wrong audience — and no one discovers this until a customer is already struggling at go-live. The irony is that the evidence needed to fix it already exists inside every customer's environment, sitting in years of closed cases and resolved tickets. The question is whether AI can read that evidence, diagnose the gaps, and do something about them.

---

## Good to have
- ~~Versioning of analysis to compare between~~ — resolved: `x_snc_kb_refinery_snapshot` is append-only per `(article, stage)`, and each row also carries an explicit `version` integer (the run number) so a consumer can pull one run's whole raw/converted/enriched trio by an exact match rather than reducing "latest per type" independently. See `tables.md`.
- TBD

---

## Demo Plan
1. As a ServiceNow customer, show the before state and pain points.
2. Show the refinery working
3. Show the improvements after the refinery.

* Comparison between before / md / after
* Show fancy animation of the refinery working
* TBD

---

## Pipeline Overview

Implemented as an async, batched, callback-driven state machine — not one long synchronous
script execution, and (as of 2026-09-03) not one whole-job phase either: `RefineryOrchestrator`
creates one `x_snc_kb_refinery_job_item` per article up front, splits them into batches of
`LLM_BATCH_SIZE`, and runs each batch's pipeline independently. Converting is synchronous (no LLM
calls); every phase after that dispatches one `executionRequests` array per batch and returns.
`RefineryLLMCallback` (registered as the `callbackHandler`) receives the results later — one
callback per dispatch, each result keyed with its own `meta.user_data` for correlation (confirmed
shape, not a guess — see `.claude/rules/kb-refinery-domain.md`) — and either dispatches that
item's next stage or marks it `completed`/`failed`. Because dispatching a batch returns
immediately, batches (and therefore articles) genuinely progress at different rates: one can be
`enriching` while a sibling batch is still waiting on its `analyzing` call, and an article with no
content-gap Finding reaches `completed` right after analyzing while one with a gap keeps going.
`Job.status` is coarse (`pending`/`running`/`completed`/`completed_with_errors`/`failed`); the
real per-article phase lives on `x_snc_kb_refinery_job_item.status` instead.

`MAX_ARTICLES_PER_RUN` (how many `kb_knowledge` articles one scheduled run pulls in) and
`LLM_BATCH_SIZE` (how many articles go into one pipeline batch, and therefore one
`executionRequests` array) are **independent** constants in
`src/fluent/script-includes/refineryOrchestrator.server.js` — a run's articles get split into
multiple batches, each progressing through the phases below on its own, when the former exceeds
the latter.

1. **converting** (synchronous, one Job Item status) — for each article in the batch:
   find-or-create Analysis (skip if unchanged since it last reached `pipeline_stage: ready` — Job
   Item becomes `skipped`), write a `raw` Snapshot (mechanical score only, no LLM — see
   Re-scoring Pass below), convert HTML→Markdown (`HTMLToMarkdownLib`), validate links (no LLM —
   broken ones become `broken_link` Findings immediately), write a `converted` Snapshot. Then
   dispatches the batch's **analyzing** call for every article that converted successfully.
2. **analyzing** (async, batched) — Call 1 per article: findings, search terms, standardized
   summary, product mentions, `llm_score` on the `converted` Snapshot. On the result: an article
   with no content-gap Finding is done (Job Item → `completed`); one with a gap dispatches
   **enriching** next.
   - **deduplicating** runs as a side-channel off this same result, not its own phase or Job Item
     status: each article is compared against every other already-analyzed article in the same
     job (any batch), and a confirmed pair gets `duplicate` Findings on both sides. Never gates or
     delays the item's own status.
3. **enriching** (async, batched) — for articles with a content-gap Finding: incident search
   (`RefineryIncidentSearch`, Layers 1+2, done synchronously right before each item's prompt is
   built) → Call 2 (Layer 3) → Evidence rows, `Analysis.enrichment_knowledge` persisted for the
   next phase (this replaces an earlier in-memory hand-off that wouldn't have survived the async
   boundary). Extraction no longer requires incident evidence (2026-09-03) — the model may draw on
   general domain/product knowledge when incidents are thin or absent. Extractable → dispatches
   **scoring** next; genuinely not extractable → Job Item `completed`.
4. **scoring** (async, batched, two round-trips under one Job Item status) — Call 3 (Article
   Synthesis) produces the rewritten article → `enriched` Snapshot, then immediately dispatches
   Call 1 again against that rewritten content so raw/converted/enriched are all scored
   identically. On that result: `pipeline_stage: ready`, Job Item → `completed`.

Job finalization is a small counter, not a whole-job re-derivation on every article's status
change (2026-09-03 revision, to shrink where a race between two concurrent finalize-checks could
occur): `Job.remaining_batches` is set to the batch count when the job starts, and decremented by
exactly 1 each time a *batch's* every Job Item reaches a terminal status
(`_checkBatchFinished`/`_decrementRemainingBatches`). Once it reaches 0, `_finalizeJob` runs
once: all `completed` (or `skipped`, a clean outcome) → `Job.status = completed`; any `failed`
mixed with at least one success → `completed_with_errors`; every item `failed` → `failed`.

---

## Data Model

Full current schema lives in `tables.md` — 8 pipeline tables (`analysis`, `snapshot`, `finding`, `evidence`, `product`, `mention`, `job`, `job_item`) plus `prompt_template` (9 total), built and verified via `now-sdk build`. The version below is kept only for the Finding Types reference table; everything else here (field lists, the single-row-per-article Analysis shape, 0–10 vs 0–100 scoring) is superseded — don't build against it.

#### Finding Types

| Type | Source | Description |
|------|--------|-------------|
| `outdated` | Call 1 | Content appears stale relative to last updated date |
| `incomplete` | Call 1 | Does not fully address the topic in the title |
| `image_dependent` | Call 1 | Article relies on images with insufficient text explanation |
| `no_resolution_steps` | Call 1 | Describes a problem but lacks actionable resolution steps |
| `too_vague` | Call 1 | Steps are ambiguous or not specific enough to follow |
| `audience_mismatch` | Call 1 | Article is in end-user KB but requires admin/developer access (or vice versa) |
| `missing_prerequisites` | Call 1 | Does not state required access, tools, or permissions upfront |
| `no_error_guidance` | Call 1 | No troubleshooting steps if the procedure fails |
| `missing_context` | Call 1 | References concepts, systems, or processes without explanation |
| `unlinked_product` | Call 1 | Mentions other products/services without linking to their KB articles or providing context |
| `broken_link` | Conversion | Contains a hyperlink returning 404 or non-200 status |
| `duplicate` | Cross-article pass | Substantial content overlap with another article |

See `tables.md` for the Evidence (Findings ↔ Incidents), Product Index, Mention, and Job tables as actually built.

---

## HTML → Markdown Conversion

- Use a JS library (runs server-side on instance)
- Strip before converting: `<style>`, `<script>`, `<meta>`, `<link>`, empty wrapper `<div>`s
- **Layout tables:** strip (heuristic: no `<th>`, single column, `role="presentation"`, nested tables, `width="100%"`) — unwrap and keep text content
- **Data tables:** keep and convert to markdown tables
- **Images:** do NOT send to a vision model — instead, count images and flag articles that are image-heavy but text-light as an `image_dependent` finding
- **Link validation:** extract all `<a href>` during conversion, issue HTTP HEAD requests, record broken links as findings with the URL — implemented (`RefineryOrchestrator._checkLinks`)

**Known gap**: the layout-table/empty-`<div>` stripping heuristics above are **not yet
implemented** — `RefineryOrchestrator._phaseA_converting` currently calls
`new HTMLToMarkdownLib().translate(rawHtml)` with no custom translators at all, so
`docs/ideas/Conversion and Identification.md`'s Strategy 1 (`postprocess` interception, the
server-side-safe approach — Strategy 2's `DOMParser` doesn't exist in this scripting context) was
never wired in. `<script>`/`<style>` get stripped for free (`node-html-markdown` already drops
them), but layout tables and empty wrapper `<div>`s currently convert as-is. Not a correctness bug
— just an unfinished piece of the conversion step.

---

## Incident Lookup Strategy

**Structured pre-filter → LLM relevance scoring** (NOT RAG). Layers 1+2 are implemented in
`RefineryIncidentSearch.findCandidates(category, searchTerms)` — Layer 3 (the LLM pass) is Call 2
above, dispatched by `RefineryOrchestrator._buildEnrichingItem`.

**Not yet verified**: `RefineryIncidentSearch`'s Resolved/Closed `incident.state` values (`6`/`7`)
are the common out-of-box defaults, not confirmed against `surfuat2` — state choices are commonly
customized per instance. Re-check before trusting this filter.

### Layer 1: Narrow with structured fields
```
category = KB article's category
AND state IN (resolved, closed)
AND resolved_at > last 12 months
AND resolution_notes IS NOT EMPTY
```

### Layer 2: Keyword overlap
- Extract up to 8 search terms from LLM Call 1
- OR-chain LIKE queries on `short_description` and `close_notes`:
  ```
  short_descriptionLIKEterm1^ORclose_notesLIKEterm1^ORshort_descriptionLIKEterm2^ORclose_notesLIKEterm2...
  ```

### Layer 3: LLM as semantic layer
- Pass KB article + ~20-50 filtered incident summaries to LLM
- Ask: "Which of these incidents reveal information missing from this article?"

---

## Duplicate Detection (Cross-Article Pass)

Runs after all articles have been individually analyzed in Call 1.

**Approach:**
- Compare `standardized_summary` and `search_terms` across articles within the same KB
- Articles with high overlap in search terms (>60% intersection) are candidates
- LLM confirmation: pass both article summaries and ask if they cover the same topic
- Create `duplicate` findings on **both** articles, each referencing the other via `related_article`
- When duplicates are found, identify which article is more recent/complete and recommend consolidation direction

**Output for demo:** "Found 8 duplicate pairs across 200 articles. Recommended consolidating into the more recently updated article in each pair."

Implemented as `RefineryOrchestrator._checkForDuplicates`, run as a side-channel off each
article's own analyzing result rather than a separate phase (2026-09-03) — it compares against
every other already-analyzed article in the same job, regardless of which batch either belongs
to, and never gates or delays either article's own status. The LLM confirmation call is a real
prompt template (`duplicate_confirmation`).

---

## LLM Calls

Three numbered calls (1/2/3), same as before — but Call 1 is now dispatched **three times** per
article, once each against raw HTML, converted markdown, and (once it exists) rewritten enriched
markdown, rather than once against converted only. This is deliberate: `raw`/`converted`/`enriched`
need to be scored by the exact same prompt, asked the exact same way, or their `llm_score`s aren't
actually comparable — see "Re-scoring Pass" below for why a separate, narrower prompt per stage was
tried and rejected in favor of this. All prompts (plus the duplicate-confirmation call in Duplicate
Detection) are stored as `x_snc_kb_refinery_prompt_template` rows and rendered via
`RefineryPromptTemplate.render(name, vars)`, not hardcoded strings — see
`src/fluent/data/record/x_snc_kb_refinery_prompt_template_*.now.ts`.
Every call is dispatched **async and batched** — `RefineryOrchestrator` builds up to
`LLM_BATCH_SIZE` prompts per pipeline batch and hands them to `RefineryLLM.dispatchBatch(items)`
as one `executionRequests` array; results come back later via `RefineryLLMCallback`, not as a
return value. The raw-content invocation of Call 1 is built and dispatched alongside the
converted-content one, during the same `analyzing` step (one extra prompt per article, not a
separate step of its own) — see `RefineryOrchestrator._buildRawScoringItem`. The enriched-content
invocation runs later, once the rewrite lands, immediately following it under the same `scoring`
Job Item status (see "Pipeline Overview" above) — see
`RefineryOrchestrator._buildEnrichedScoringItem`. `RefineryLLM.CAPABILITY_ID`/`SKILL_CONFIG_ID` are
the real, confirmed IDs for the "Knowledge Refinery" Now Assist Skill (see Status above). Every
prompt template's own "Output Format" instructs the model to wrap its JSON reply in a fenced
` ```json ` code block; `RefineryLLMCallback` parses each reply via the local
`RefineryJsonUtil.safeJSONParse` helper, which strips that fence.

### Call 1: Quality Analysis (new conversation per article, dispatched 3 times)

**Inputs:** `{{title}}`, `{{articletype}}`, `{{kbname}}`, `{{lastupdated}}`, `{{currentdate}}`, `{{content}}`

**Outputs:** `quality_score`, `target_audience`, `standardized_summary`, `findings[]`, `search_terms[]`, `product_mentions[]`, `summary`. `standardized_summary` and `product_mentions` were added to the actual prompt template — the original `KB Article Analysis.md` doc never asked for them, even though `Analysis.standardized_summary` and the Product/Mention tables need them. The findings `type` enum was likewise extended with `missing_context`/`unlinked_product`, which this doc already said Call 1 detects but the original enum omitted.

**Dispatched 3 times per article, not 1 (2026-09-02):** once against the `raw` snapshot's content
(during the `analyzing` step, alongside the converted-content invocation — see
`RefineryOrchestrator._buildRawScoringItem`), once against `converted` (the "real" invocation,
whose full response is persisted below), and once against `enriched` once Call 3 has produced it
(immediately following the rewrite, under the same `scoring` Job Item status — see
`RefineryOrchestrator._buildEnrichedScoringItem`). Only
`quality_score` is kept from the raw and enriched invocations; their findings/search_terms/
target_audience/summary/product_mentions are discarded, since those describe the *converted*
content's current state and would otherwise create duplicate/conflicting Finding and Mention rows.
This is deliberately the same prompt every time, not three separately-worded ones — see
"Re-scoring Pass" below for why that matters.

**Key decisions:**
- Search terms use informal user-facing language, not documentation terminology
- Aliases count separately (e.g., "O365" and "Office 365" are two terms)
- Cap at 8 terms
- `target_audience` classification based on whether steps require elevated access
- `standardized_summary` follows consistent format: "[Action verb] [what] [for whom] [when/context]"
- `product_mentions` extracted and fed into the Product Index Table
- Also detects: `missing_context`, `unlinked_product`

### Call 2: Incident-Informed Enrichment (separate new conversation)

**Inputs:** Article markdown + findings from Call 1 + filtered incident summaries from Layer 2

**Purpose:** Determine if gathered incident information can fill gaps and produce an "AI-specific" KB with deterministic actions.

**Outputs:** incident relevance analysis, gap coverage assessment, AI-ready knowledge extraction (conditions → actions → escalation criteria), recommendations, confidence level

**Key decisions:**
- Separate conversation, not continuous with Call 1
- Pass Call 1 outputs as structured inputs, not chat history
- Reduces cost and improves debuggability
- Output stays structured (`ai_ready_knowledge`, `recommendations`, `gap_coverage`) — it never produces a full rewritten article. That's Call 3's job (see below), added specifically to close that gap.

### Call 3: Article Synthesis (new — not in the original 2-call design)

**Why this exists:** Call 2's output is structured knowledge, not prose — there was no path from
"gaps closed" to an actual rewritten article for `x_snc_kb_refinery_snapshot(type='enriched').content`,
which the before/after demo needs. Rather than mechanically templating Call 2's JSON into markdown,
a third call rewrites the article properly.

**Inputs:** the original converted markdown, Call 1's gap findings, Call 2's `ai_ready_knowledge`/`recommendations`. Deliberately does **not** re-receive raw incident text — only Call 2's already-distilled output, so incident content (potential PII, see `security.md`) only ever reaches one prompt, not two.

**Outputs:** `enriched_content` (full rewritten markdown article), `summary`. **Rewrite-only as of
2026-09-02** — this call used to also self-score its own output via a compressed paraphrase of
Call 1's rubric, evaluated inside the same completion as the rewrite task. That made
`enriched.llm_score` not genuinely comparable to `raw`/`converted`'s scores. Scoring
`enriched_content` now happens right after this call, under the same `scoring` Job Item status
(see "Pipeline Overview" above), not this call's own job — see `docs/prompts/Article Synthesis.md`'s
"Key decisions."

### Re-scoring Pass (3-point progression) — two scores per stage, one prompt reused three times

Three content stages, stored as three `x_snc_kb_refinery_snapshot` rows per article per run
(`type` = `raw`/`converted`/`enriched`, see `tables.md`). Each row carries **two** scores:

| Snapshot `type` | `score` (AIReadabilityScorer, mechanical) | `llm_score` (LLM's own rubric) |
|-------|----------|---------------|
| `raw` | raw HTML, as-is | Call 1, dispatched against the raw content, during `analyzing` |
| `converted` | converted markdown | Call 1, dispatched against the converted content, during `analyzing` |
| `enriched` | Call 3's `enriched_content` | Call 1, dispatched against `enriched_content`, immediately following the rewrite, under the same `scoring` Job Item status |

`score` is computed the same way at every stage by `AIReadabilityScorer` — genuinely comparable.
`llm_score` is now **the same prompt asked the same way at every stage too** — Call 1
(`kb_article_analysis`), just fed different content each time, with everything but
`quality_score` discarded for the raw/enriched invocations (see Call 1 above).

**Revised twice (2026-09-02).** First pass: `raw` used to be deliberately non-LLM entirely (a free,
deterministic baseline) — reusing `converted`'s score for it wasn't an option (wrong content), so
a separate, narrower `raw_content_quality` prompt was added instead, asking only for
`quality_score`. Second pass, after review: a differently-worded prompt asking only for one field
in isolation doesn't produce a score comparable to Call 1's full response, even scoring identical
content — a model's score can shift depending on what else it's asked to produce in the same
completion. `enriched` had the analogous problem: Call 3 self-scored its own rewrite via a
one-line paraphrase of Call 1's rubric, embedded in the same completion as the rewrite task.

**The fix for both, landed together:** retire the separate `raw_content_quality` prompt and Call
3's self-scoring both, and instead dispatch the literal `kb_article_analysis` prompt a second and
third time per article — once against `raw`, once against `enriched_content` after Call 3 produces
it — discarding everything from those responses except `quality_score`. This is strictly more LLM
calls than either prior design (three dispatches of Call 1 per article now, plus a whole new
async round-trip for the enriched one) — accepted deliberately, because the
entire point of this re-scoring pass is a genuine, apples-to-apples 3-point comparison, and neither
prior design actually delivered that.

All three snapshot rows are persisted for evals and benchmarking — you can re-run scoring with
different rubrics or feed each version to an AI agent to measure task completion rates.

**Demo value:** "Format conversion alone improved scores from 38 → 55. Incident enrichment pushed them to 82." — now backed by two independently comparable numbers per stage instead of one that silently switched rubrics partway through.

---

## UI / Dashboard

### Overview Dashboard
- **Total articles** vs. **analyzed** vs. **not yet analyzed** (progress bar)
- **Current job status** — real per-article counts grouped by `x_snc_kb_refinery_job_item.status` (`pending`/`converting`/`analyzing`/`enriching`/`scoring`/`completed`/`failed`/`skipped`), not a single whole-job phase — see "Pipeline Overview" above
- **Quality score distribution** — histogram or breakdown by range (0-25, 26-50, 51-75, 76-100)

### Per-KB View
- Quality score breakdown by knowledge base
- Finding type distribution per KB
- Audience classification breakdown (end_user / admin / developer / mixed)

### Findings View
- Findings by type and severity
- Filterable by KB, article, finding type, state
- Duplicate pairs listed with consolidation recommendation

### Before/After View
- Articles with both a `raw`/`converted` and an `enriched` snapshot (see `tables.md`)
- Side-by-side comparison showing which gaps were closed by incident data
- Aggregate: average score improvement across the KB

**Partially implemented (2026-09-02)**: `pages/analysis-report/[sysId]`'s content viewer gives the
side-by-side comparison, per article, as a rendered (not diffed) view of any 1–3 of
raw/converted/enriched — see the Status section above. The score comparison table on the same page
covers the per-article "which gaps were closed" numbers (mechanical + LLM score, word/token/image/
link counts per stage). **Not yet built**: the KB-wide aggregate (average score improvement across
the whole KB) — that's a cross-article rollup, not something this per-article page produces.

### Product Index View
- List of detected products with article counts
- Products mentioned in articles but with no dedicated KB article (KB-level gap)

---

## Design Principles

- **No RAG for incident search** — structured queries handle 90%, LLM handles the semantic gap
- **Batch convert, then analyze** — conversion is deterministic data prep; analysis is iterative logic. Keep them separate.
- **Findings, not fixes** — flag image-dependent articles rather than sending images to vision models
- **Audience mismatch is a finding** — an article in an end-user KB requiring admin access is a quality issue
- **Rerun-friendly** — `source_updated_on` + `last_job` (Analysis) and `processed_at` (Snapshot) enable incremental processing
- **Cross-article intelligence** — duplicate detection and product indexing go beyond single-article analysis to provide KB-level insights
- **Before/after storytelling** — re-scoring after enrichment demonstrates measurable impact, not just diagnosis
- **Link checking is cheap** — validate links during conversion at near-zero cost; broken links are a high-confidence finding with no LLM needed
