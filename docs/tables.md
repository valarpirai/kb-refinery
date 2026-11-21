# Data Model

Canonical reference for the app's tables, defined in `src/fluent/tables/*.now.ts` (plus
`x_snc_kb_refinery_prompt_template`, which extends `sys_metadata` and lives there too). This
supersedes the "Data Model" section of `plan.md`, which described an earlier version of this
schema.

Scope prefix `x_snc_kb_refinery_` (18 chars) leaves only 12 characters of a table's 30-char limit for its own name — several table names below are short as a result (`snapshot`, `evidence`, `mention` rather than more descriptive alternatives).

## `x_snc_kb_refinery_analysis` — Analysis

One row per source KB article, holding its current pipeline state. Content and scores do **not** live here — see Content Snapshot below.

| Field | Type | Notes |
|---|---|---|
| `source_table` | TableNameColumn | Which table the source article lives in (`kb_knowledge`, `kb_knowledge_block`, …) |
| `source_record` | DocumentIdColumn | Polymorphic reference to the article, resolved via `source_table` (native SDK pattern for a document-ID field, not a hand-rolled sys_id string) |
| `source_class` | String(80) | Denormalized `sys_class_name` of the source record, for filtering by KB class without a join |
| `source_updated_on` | DateTime | Snapshot of the article's `sys_updated_on` at last processing — enables skip-on-rerun |
| `kb_knowledge_base` | Reference → `kb_knowledge_base` | Denormalized for per-KB reporting without a join |
| `standardized_summary` | String(500) | One-line LLM summary, consistent format for scanning/RAG |
| `search_terms` | JSON | Up to 8 user-facing search terms from Call 1 — feeds incident-lookup Layer 2 and duplicate detection |
| `target_audience` | Choice | `end_user` / `admin` / `developer` / `mixed` |
| `pipeline_stage` | Choice, default `ingested` | `ingested` / `analyzing` / `restructuring` / `validating` / `ready` / `failed` — drives the kanban board directly instead of being inferred from which content fields are populated. `failed` ("Finished with Errors") covers both a genuine LLM/dispatch failure and the enriching phase's "insufficient incident coverage" skip — either way, this article has no further route to `ready` for the run, so it's marked rather than left reading `analyzing` forever with nothing distinguishing "still working" from "this is as far as it got" |
| `enrichment_confidence` | Choice | `high` / `medium` / `low`, from Call 2 |
| `enrichment_knowledge` | JSON | Call 2's `ai_ready_knowledge` + `recommendations`, persisted here because Call 2 (enriching phase) and Call 3 (Article Synthesis, rescoring phase) are separate async round trips — Call 3's batch dispatch reads this back rather than relying on anything held in memory across the callback boundary. Non-null also doubles as the rescoring phase's work-item filter |
| `last_job` | Reference → Job | Denormalized pointer to the most recent job that touched this article |

## `x_snc_kb_refinery_snapshot` — Content Snapshot

Child of Analysis. One row per `(article, stage)` **per pipeline run** — append-only, never overwritten. `version` (an Integer — the pipeline-run number: 1 on the first run for this article, 2 on the second, etc.) is what actually ties one run's raw/converted/enriched trio together; a consumer that needs all of one run's rows should filter by matching `version`, not by reducing "latest per type" independently — the two aren't equivalent if a run's enrichment failed and an *older* run's `enriched` row would otherwise get pulled in alongside this run's `raw`/`converted`. See `pages/analysis-report/[sysId]/analysis-report-data.js`'s `fetchLatestVersion`/`fetchSnapshotsForVersion` for the reference implementation.

| Field | Type | Notes |
|---|---|---|
| `parent` | Reference → Analysis | Mandatory |
| `type` | Choice, mandatory | `raw` / `converted` / `enriched` |
| `version` | Integer | The pipeline-run number this row belongs to. Computed once per run — count of this Analysis' prior `type='raw'` rows + 1 (`RefineryOrchestrator._nextSnapshotVersion`) — and shared by that run's `raw`/`converted` writes (same synchronous call) and its later, async `enriched` write (`RefineryOrchestrator._currentSnapshotVersion`, read back off the run's own `raw` row — safe because the job-lock guard never allows two runs in flight for the same Analysis at once) |
| `content` | MultiLineText(4,000,000) | Full text for this stage. `maxLength` set explicitly and generously — `MultiLineTextColumn` silently truncates to 40 chars if omitted (verified platform behavior, see `.claude/rules/environment-build-deploy.md`) |
| `score` | Integer(0–100) | Mechanical/structural score, `AIReadabilityScorer` — computed the same way for every `type`, so these three numbers are genuinely comparable across the raw→converted→enriched progression. See `plan.md`'s Re-scoring Pass section |
| `llm_score` | Integer(0–100) | The LLM's own semantic quality_score for this stage — the literal `kb_article_analysis` prompt (Call 1), dispatched three times per article against `raw`/`converted`/`enriched` content respectively, not three separately-worded prompts. Only `quality_score` is kept from the `raw`/`enriched` invocations. See `plan.md`'s Re-scoring Pass section |
| `word_count`, `token_count`, `image_count`, `link_count`, `broken_link_count` | Integer | Scoped to *this* content version — raw HTML word count ≠ markdown word count, and enrichment can change image/link counts. `token_count` is computed via `sn_generative_ai.TokenCalculator.getTokenCount(content)` (`RefineryOrchestrator._getTokenCount`), set at all three write sites (raw/converted/enriched) |
| `processing_message` | MultiLineText(4000) | This stage's outcome for this article: a hard failure, **or** a legitimate "couldn't proceed" result (e.g. "enrichment skipped: insufficient incident coverage"). Not always an error — see `plan.md` for the reasoning |
| `processed_at` | DateTime | When this stage ran for this row |
| `last_job` | Reference → Job | |

## `x_snc_kb_refinery_finding` — Finding

| Field | Type | Notes |
|---|---|---|
| `parent` | Reference → Analysis | Mandatory |
| `type` | Choice, mandatory | `outdated`, `incomplete`, `image_dependent`, `no_resolution_steps`, `too_vague`, `audience_mismatch`, `missing_prerequisites`, `no_error_guidance`, `missing_context`, `unlinked_product`, `broken_link`, `duplicate` |
| `severity` | Choice | `high` / `medium` / `low` |
| `detail` | MultiLineText(4000) | LLM's explanation |
| `state` | Choice, default `new` | `new` / `acknowledged` / `remediated` / `cancelled` (set on every Finding left over from a prior run of the same Analysis once a new run starts — see `RefineryOrchestrator._cancelPriorFindings`) |
| `related_article` | Reference → Analysis | For `duplicate` findings — the other article in the pair |
| `recommended_primary` | Reference → Analysis | For `duplicate` findings — which article should absorb the other, as a queryable field rather than buried in `detail` prose |
| `broken_url` | String(1000) | Plain string, deliberately **not** `UrlColumn` — its `http(s)://` validation would reject exactly the malformed links this field exists to record |
| `last_job` | Reference → Job | |

## `x_snc_kb_refinery_evidence` — Evidence (Findings ↔ Incidents)

Join table, not the SDK's `ReferenceColumn` `mtom`/`sys_collection` mechanism — that mechanism fits a pure membership relation, but this link carries its own payload per pair, so it needs a real table.

| Field | Type | Notes |
|---|---|---|
| `finding` | Reference → Finding | Mandatory |
| `incident` | Reference → `incident` | Mandatory |
| `new_information` | MultiLineText(4000) | What this incident adds that the article lacks (Call 2 output) |
| `contradicts_article` | Boolean | Call 2 output |

## `x_snc_kb_refinery_product` — Product Index

| Field | Type | Notes |
|---|---|---|
| `name` | String(200), mandatory | Canonical product name |
| `aliases` | String(1000) | Comma-separated |
| `type` | Choice | `internal` / `external` / `vendor` / `platform` |
| `article_count` | Integer, default 0 | Maintained counter for fast dashboard tiles |
| `dedicated_article` | Reference → Analysis | Populated = has a dedicated article; null = it doesn't. No separate boolean flag, so the two can't drift out of sync |

`article_count` is read directly (no join through `mention`) by the home page's
`widgets/product-word-cloud` — a word cloud sized by this field, i.e. the first
real consumer of the "fast dashboard tiles" comment above.

## `x_snc_kb_refinery_mention` — Product Mention (Analysis ↔ Product)

| Field | Type | Notes |
|---|---|---|
| `analysis` | Reference → Analysis | Mandatory |
| `product` | Reference → Product | Mandatory |
| `mention_count` | Integer, default 1 | How many times the product is mentioned in that specific article |

Lets the Product Index View drill into "which 12 articles mention Okta," not just a count.

## `x_snc_kb_refinery_job` — Analysis Job

| Field | Type | Notes |
|---|---|---|
| `started_at`, `completed_at` | DateTime | |
| `status` | Choice, default `pending` | `pending` / `running` / `completed` / `completed_with_errors` / `failed` — coarse job-level lifecycle only, as of 2026-09-03. Which pipeline phase a specific article is actually in lives on its own `x_snc_kb_refinery_job_item.status` row instead (see below) — a single job-level phase field can't represent it, since different articles/batches genuinely progress at different rates. The job-lock guard (`RefineryOrchestrator.run`) checks `status NOT IN (completed, completed_with_errors, failed)` |
| `articles_total`, `articles_processed`, `articles_skipped`, `findings_generated`, `duplicates_found`, `broken_links_found` | Integer, default 0 | Counters |
| `remaining_batches` | Integer, default 0 | Set to the total batch count once, when the job starts; decremented by 1 each time a batch's every Job Item reaches a terminal status. Reaching 0 finalizes the Job (`RefineryOrchestrator._checkBatchFinished`/`_finalizeJob`) |
| `error_message` | MultiLineText(4000) | **Batch-level** failure only (the run itself crashed/timed out) — per-article, per-stage outcomes belong on Snapshot's `processing_message` instead, since one run's failures can differ article by article |
| `scope` | String(4000) | Which KBs/articles this run covers |
| `triggered_by` | Reference → `sys_user` | |

## `x_snc_kb_refinery_job_item` — Job Item

One row per (job, article) the job actually looks at, including one for a `skipped` article — the real, real-time per-article status this app's job/pipeline pages read their counters from. Created for every article up front, before conversion starts; updated in place as that article moves through the pipeline. Added 2026-09-03, replacing the phase-granularity that used to live on `x_snc_kb_refinery_job.status`.

| Field | Type | Notes |
|---|---|---|
| `job` | Reference → `x_snc_kb_refinery_job` | |
| `kb_knowledge` | Reference → `kb_knowledge` | Captured at creation, before any Analysis row is resolved |
| `analysis` | Reference → `x_snc_kb_refinery_analysis` | Populated once conversion finds/creates the Analysis row; blank for the brief `pending` window before that |
| `status` | Choice, default `pending` | `pending` / `converting` / `analyzing` / `enriching` / `scoring` / `completed` / `failed` / `skipped`. `scoring` covers both the article-rewrite call and the immediately-following re-score-the-rewrite call — no checkpoint in between. Deduplication has no dedicated status: it runs as a side-channel off the `analyzing` result (see `refineryOrchestrator.server.js`) and never gates an item's own status |
| `batch_number` | Integer, default 0 | Assigned once at creation (`LLM_BATCH_SIZE` articles per batch). Batches progress through the pipeline independently — one can be `enriching` while another is still waiting on its `analyzing` dispatch |

## `x_snc_kb_refinery_prompt_template` — Prompt Template

Read-only reference table for the pipeline's LLM prompts, modeled directly on the sibling
`AI Group Chat` app's `x_snc_ai_grp_chat_prompt_template` table — data instead of hardcoded prompt
strings in script. Extends `sys_metadata`.

| Field | Type | Notes |
|---|---|---|
| `name` | String(255), mandatory | e.g. `kb_article_analysis`, `incident_enrichment`, `article_synthesis`, `duplicate_confirmation` |
| `template` | String(16000) | The prompt text, with `{{var}}` placeholders |

Rendered via `RefineryPromptTemplate.render(name, vars)` (a `{{var}}` substitution over
`template`). The four current rows are seeded as `Record()` fixtures under
`src/fluent/data/record/x_snc_kb_refinery_prompt_template_*.now.ts` so they deploy with the app.
`actions: {read: true, update/delete/create: false}`, matching the sibling app's table exactly.

## Access

`x_snc_kb_refinery.user` (`src/fluent/roles/user.now.ts`) is granted `create`/`read`/`write`/`delete` on the 8 pipeline tables (`src/fluent/acls/*.now.ts`, 32 `Acl()` records total, `adminOverrides: true`), plus a single `read`-only ACL on `x_snc_kb_refinery_prompt_template` (`src/fluent/acls/prompt_template.now.ts`), matching that table's own `actions`. See `security.md` for what this does and doesn't cover.

Every table's `actions.read` is now `true` (flipped from `false` on all but `prompt_template`, which already had it) — this only controls whether the Table API exposes `GET` for the table at all; real read authorization is still exclusively the `Acl()` records above (see `security.md`).

## Deliberately deferred (not in this pass)

- **Related lists** — no `sys_relationship`/`sys_ui_related_list` records yet, so child records (Snapshot/Finding under Analysis, etc.) won't show as related lists on the native form. Add when the admin-facing inspection UI is actually needed.
- **Table-level unique constraints** — verified as a no-op on this SDK version (`Table({ index: [...] })` reserves a `sys_index` id but never lands in the install package — see `.claude/rules/environment-build-deploy.md`). If `x_snc_kb_refinery_mention` or similar needs real duplicate-pair prevention, enforce it in script (check-then-insert), not via `index`.

## A build-time thing to know before deploying

Every `ChoiceColumn`'s values landed in `dist-metadata/app/author_elective_update/` on this build, not the main install path — confirmed, matches a known SDK behavior (new choice values are "elective," opt-in content, not automatically applied by an ordinary `now-sdk install`). Verify the choices actually land on the target instance after the first real deploy; if they don't, use the update-set/configuration install mode (see `.claude/rules/environment-build-deploy.md`) or insert them manually.
