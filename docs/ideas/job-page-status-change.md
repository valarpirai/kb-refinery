# Job Item status tracking — reference notes (in progress)

This file is a working doc for the "job page status is confusing" request:

1. Combine statuses: `analyzing`+`deduplicating` → `analyzing`; `rescoring`+`scoring_enriched` → `scoring`. No forced ordering across articles.
2. Create a per-article Job Item record for every article a job works on; update it in real time as the pipeline progresses.
3. Group by Job Item status for the counters on every relevant page.

**Status: paused for review.** The section below documents the *current* orchestration flow in full (the user asked for this before deciding how the new Job Item writes should slot in). Pick this back up by re-reading this file, then resolving the open question at the bottom.

---

## Gilad's suggested flow
- job item table - add an integer field for batch number.
- use both `scoring` and `scoring_enriched` in the job item status.
- I do not mention the analysis / snapshot records updates in the plan, I assume you know when to update them and with what, if you are not sure, ask me and I will tell you.

### Step 0
1. scheduled job triggered / user selected a KB article in the home page.
2. get the number of KB articles we are going to work on in the pipeline (GlideAggregate count).
3. create a job record and populate relevant fields (triggered by, articles total, etc) with pending status.
4. the script queues the job (using the mechanism we already have).
5. queued job gets triggered and status gets updated to running.
6. constructs an empty job item array.
7. runs the GlideRecordSecure query to get all the KB articles (using the limit constant to limit the results).
8. captures all the required information from the record into the job item array (we want to release the DB connection and not hold it).
9. start a new batch number counter (starting with 1).
10. loop over the job item array:
10a. create a job item record with status pending and all the relevant information and the current batch number.
10b. every X items (the batch size we decide in the constant), it will queue the conversion stage with job id (sys_id) and batch number.

### Step 1 - Conversion
1. queued batch gets triggered.
2. pulls all the job items for the batch that are in pending state.
3. As you loop over the items, update their status to converting.
4. start the html to markdown conversion.
5. after conversion is done for the batch, queue the analysis stage with job id (sys_id) and batch number.

### Step 2 - Analysis
1. queued batch gets triggered.
2. pulls all the job items for the batch that are in converting state.
3. As you loop over the items, update their status to analyzing.
4. while looping over the items, prepare the batched LLM analyzing call for all the job items for both the raw and converted snapshots, including the scoring stage and the job item id (sys_id).
5. execute the async batched LLM call.

### Step 3 - Scoring
1. Skill callback gets triggered.
2. pulls all the job items for the batch that are in analyzing state.
3. As you loop over the items, update their status to scoring.
4. while looping over the items:
4a. store the analysis results in the snapshot records and update the analysis record accordingly.
4b. prepare the batched LLM scoring call for all the job items for both the raw and converted snapshots, including the enrichment stage and the job item id (sys_id).
4c. run the mechnical scoring for both raw and converted and store in the snapshot record.
5. execute the async batched LLM call.

### Step 4 - Enrichment
1. Skill callback gets triggered.
2. pulls all the job items for the batch that are in scoring state.
3. As you loop over the items, update their status to enrichment / enriching.
4. while looping over the items:
4a. store the scoring results in the snapshot records and update the analysis record accordingly.
4b. perform the enrichment flow, **new addition**: don't fail the enrichment if no relevant incidents were found, attempt the enrichment without the incidents.
4c. prepare the batched LLM scoring call for all the job items for enriched snapshots, including the enrichment scoring stage and the job item id (sys_id).
4d. if for some reason, the enrichment could not continue for this job item, mark it as completed / finished with errors.
5. execute the async batched LLM call.


### Step 5 - Enrichment scoring
1. Skill callback gets triggered.
2. pulls all the job items for the batch that are in scoring state.
3. while looping over the items:
3a. store the enrichment scoring results in the snapshot record and update the analysis record accordingly.
3b. update their status to completed (or failed, based on the outcome).

### **IS IT FINISHED** check
1. Check if the job is completed based on the counters, if all the completed / failed job item status sums up to the number of total articles in the job record, it means the job finished completely.
2. If the job finished, mark the job as completed, if there are any issues, mark it as completed / finished with errors, if there are ONLY issues (no clean completed job items) mark it as failed.

---

## Current flow, as implemented today (`src/fluent/script-includes/refineryOrchestrator.server.js`)

`Job.status` (`x_snc_kb_refinery_job.status`) does two jobs at once today:
1. **Lock guard** — "is any job currently running?" (`RefineryOrchestrator.run()` checks `status NOT IN (completed, failed)`).
2. **Phase pointer** — "which of the 7 phases is the *whole job* in right now?" (`PHASE_ORDER = ['converting','analyzing','deduplicating','enriching','rescoring','scoring_enriched','completed']`, plus `failed` outside that list).

### Step 0 — `RefineryOrchestrator.run(articleSysIds?)`

- Guards on the lock above; creates the Job row (`status: 'converting'`).
- Runs `_runConvertingPhase` **synchronously** (no LLM calls): for each `kb_knowledge` row, `_prepareAnalysis` finds-or-creates the Analysis row (returns `null` — and the article is just skipped, no per-article record touched — if it's unchanged since it last reached `pipeline_stage: 'ready'`), then `_phaseA_converting` does HTML→Markdown, link-checking, and mechanical (non-LLM) readability scoring, writing `raw`/`converted` Snapshots.
- Ends with `enterPhase(job, 'analyzing')`.

### Step 1 — `enterPhase(job, phase)`

```
workItems = _computeWorkItems(job, phase)     ← full list for this phase (could be 1 or 50 items)
job.status = phase                            ← the ENTIRE job flips to this phase at once
job.pending_work = JSON [workItems]           ← the FULL queue for this phase, stored on the Job row
job.pending_batch_count = 0
if workItems.length === 0: enterPhase(job, nextPhase)   ← skip empty phases entirely
else: _dispatchNextBatch(job)
if phase === 'completed': job.completed_at = now; return (job finalized)
```

`_computeWorkItems` is genuinely different shaped per phase:
- `analyzing` → Analysis rows still at `pipeline_stage='analyzing'`
- `deduplicating` → **pairs** of analysis rows (candidate duplicates, same KB + term overlap ≥ 0.6)
- `enriching` → Analysis rows that have a content-gap Finding — **a subset**; articles with no gap Finding never get a work item here and are never touched again this run
- `rescoring` → Analysis rows with `enrichment_knowledge` set
- `scoring_enriched` → enriched Snapshots with `content` set but `llm_score` still null (deduped by parent)

### Step 2 — `_dispatchNextBatch(job)` (the actual "batch" — chunks of `LLM_BATCH_SIZE = 5`)

```
batch = job.pending_work.slice(0, 5)          ← pop up to 5 items off the front
job.pending_work = remaining                  ← write back what's left
items = []
for each workItem in batch:
    built = _buildBatchItem(job, phase, workItem)   ← phase-specific prompt builder
    items.push(...built)                            ← NOTE: 'analyzing' phase returns TWO
                                                       items per workItem (a real analysis
                                                       call AND a separate raw-content
                                                       scoring call, phase:'scoring_raw') —
                                                       every other phase returns one.
job.pending_batch_count = items.length        ← how many results this ONE dispatch is waiting on
job.update()
RefineryLLM.dispatchBatch(items)              ← one executionRequests array, N prompts, ONE async call
[script execution ends — nothing more happens until the callback fires]
```

So at any moment, an article sits in exactly one of three buckets *within its phase*: still in `pending_work` (not yet picked up), counted in `pending_batch_count` (dispatched, awaiting the LLM), or already resolved (neither — the "done" bucket the batch-progress bar gets by subtraction).

### Step 3 — `RefineryLLMCallback` (platform-invoked, later, separate script execution)

```
processCompleted(response):
    for each key in response.result:            ← ONE callback call, N keyed results (confirmed batching contract)
        userData = result[key].meta.user_data    ← {jobSysId, phase, analysisSysId, ...} — set back in Step 2
        parsed = RefineryJsonUtil.safeJSONParse(result[key].result.response)
        if typeof parsed !== 'object': RefineryOrchestrator.handleBatchFailure(userData, '...')
        else: RefineryOrchestrator.handleBatchResult(userData, parsed)
    RefineryOrchestrator.onBatchItemsResolved(jobSysId, count)   ← once, with how many resolved

processErrored / processCancelled:  same shape, always → handleBatchFailure per item
```

### Step 4 — `handleBatchResult(userData, parsed)`

Routes by `userData.phase` to one of 6 handlers:
`_handleAnalyzingResult`, `_handleRawScoringResult`, `_handleDeduplicatingResult`, `_handleEnrichingResult`, `_handleRescoringResult`, `_handleEnrichedScoringResult` — each writes to Analysis/Snapshot/Finding.

- Only `_handleEnrichedScoringResult` sets `Analysis.pipeline_stage = 'ready'`.
- `handleBatchFailure` (called for `processErrored`/`processCancelled`/a dispatch-time throw) sets `pipeline_stage = 'failed'` — **except** for `phase === 'scoring_raw'`, which is comparison-only and never gates readiness.
- `_handleEnrichingResult`'s "not extractable" branch (LLM said the incident evidence isn't safely usable) **also** sets `pipeline_stage = 'failed'` — this is a deliberate skip, not an error, but it uses the same value as a genuine failure. (This ambiguity is exactly why `pages/pipeline/pipeline-data.js` doesn't trust `pipeline_stage='failed'` alone to mean "error" — it separately checks `hasGap && !enrichment_knowledge` to relabel these as `no_evidence`.)

### Step 5 — `onBatchItemsResolved(jobSysId, count)`

```
job.pending_batch_count -= count
if job.pending_batch_count > 0: return                    ← still waiting on the rest of this batch
if job.pending_work.length > 0: _dispatchNextBatch(job)    ← chew through the next chunk of 5
else: enterPhase(job, nextPhase)                           ← this phase's queue is empty — whole job advances
```

### What this means for "articles at different stages"

Every article in a job is always nominally in the same `Job.status` phase — the *only* per-article variance the current schema captures is **within** one phase, via the pending_work/pending_batch_count/resolved three-way split (which the job-progress-tracker widget's batch bar already approximates at the job level, using `articlesProcessed` as a stand-in total).

The variance the user is actually pointing at — articles genuinely finishing at different points — comes from a different mechanism: **not every article visits every phase**. An article with no content-gap Finding never gets an `enriching`/`rescoring`/`scoring_enriched` work item — it's done after `analyzing`, while a sibling with a gap keeps going for two more phases. Today that's **invisible**: that finished article's `Analysis.pipeline_stage` just sits at `'analyzing'` forever with nothing marking it done, while `Job.status` marches on to `enriching`/`rescoring` for the job as a whole. This is a documented, accepted gap in `.claude/rules/kb-refinery-domain.md` (see "`pages/pipeline`'s real-data stage bucketing is a Job.status-driven approximation").

---

## Decisions already made (from earlier discussion)

- **Skipped articles get a Job Item too** (status `skipped`), created for every article the job looks at — so counters always reconcile to the job's full article total instead of silently excluding skipped ones (mirrors the `glide-platform-facts.md` warning about groupBy/IN silently dropping a bucket with no "leftover" catch-all).
- **Scope of the counter rework**: the job tracker page (`widgets/job-progress-tracker` + `widgets/job-list-panel`) **and** the pipeline page (`pages/pipeline/pipeline-data.js`'s ring counts). Home page's rail (`pages/home/page.js`'s `RAIL_STAGES`) is explicitly **out of scope** for this pass — stays as-is.

## Open question — where do the batch mechanics live?

Given the full flow above, the original framing was: keep `Job.status`/`pending_work`/`pending_batch_count` exactly as today's internal phase-and-batch machinery (untouched), and just add Job Item writes at the right points (created in Step 0, phase flipped in Step 1's `enterPhase`, resolved in Step 4's per-item handlers and Step 4's failure paths) — i.e. Job Item becomes a *read model* layered on top of the existing machinery, not a replacement for it.

The user pushed back wanting the fuller flow shown first (this doc) before answering. **Still to resolve**: should the per-batch bookkeeping (`pending_work`, `pending_batch_count` — currently JSON blobs on the Job row) move onto the Job Item rows themselves (e.g. each Job Item carries its own "queued/in-flight/resolved" sub-state within a phase), rather than staying as job-level aggregate counters with Job Item only tracking coarse phase? This changes:
- How much of `_dispatchNextBatch`/`onBatchItemsResolved` needs rewriting (moderate → substantial).
- Whether the batch-progress bar (job-progress-tracker's `_renderBatchProgress`) can get real per-article identity for its "in-flight" segment instead of just a count.

Resume by discussing this tradeoff, then proceed to Phase 2 (design) covering: the new table's schema, exact write sites in `refineryOrchestrator.server.js`, the server-side `GlideAggregate groupBy('status')` counters, and the `widgets/job-progress-tracker` / `widgets/job-list-panel` / `pages/pipeline/pipeline-data.js` UI changes.
