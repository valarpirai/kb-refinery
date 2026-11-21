---
paths:
  - "src/fluent/script-includes/**"
  - "src/fluent/agents/**"
  - "eslint.config.mjs"
---

# kb_refinery — app-specific notes

Findings specific to this app (not generic AIUX/Fluent/karuna knowledge —
see the root `CLAUDE.md` for why those live separately in the copied
`.claude/rules/` template files instead of here).

## Script Includes keep their JS body in a sibling `.server.js` file

Every Script Include under `src/fluent/script-includes/` is split into two
files, not one inline template-literal `script` string:

- `<name>.now.ts` — the Fluent `ScriptInclude({...})` call, with
  `script: Now.include('./<name>.server.js')`.
- `<name>.server.js` — the actual `Class.create()` body.

This is the SDK's own documented pattern (`ScriptInclude`'s `script` field
doc comment literally suggests `Now.include()` for this) — not a
project-invented convention — but worth keeping consistent across every
Script Include in this app rather than mixing inline-string and
`Now.include()` styles.

## Known gap: conversion-step stripping heuristics aren't implemented

`docs/plan.md`'s "HTML → Markdown Conversion" section calls for stripping layout tables and empty
wrapper `<div>`s during conversion, via `node-html-markdown`'s custom-translator `postprocess`
hooks (the server-side-safe pattern from `docs/ideas/Conversion and Identification.md`'s
Strategy 1 — Strategy 2's `DOMParser` isn't available in this scripting context). This was never
wired in: `RefineryOrchestrator._phaseA_converting` calls `new HTMLToMarkdownLib().translate(rawHtml)`
plain, no custom translators. Link validation and broken-link Findings *are* implemented
(`_checkLinks`) — just not this piece. If you add it, the postprocess hooks go where
`HTMLToMarkdownLib` is instantiated in `refineryOrchestrator.server.js`, not in a new script
include — `HTMLToMarkdownLib`'s own `translate()` already accepts custom translators as its
constructor's second argument, per the vendored library's own API (see the doc above for the
exact shape).

## `AIReadabilityScorer` was migrated from an instance-side record to Fluent (2026-09-01)

`AIReadabilityScorer` (mechanical readability scoring — see `docs/plan.md`'s Re-scoring Pass) used
to be created directly on the instance with no source-controlled counterpart — a plain, unwired
mirror of its script body lived at `Remote/AIReadabilityScorer.js` purely for human reference, not
consumed by any build step. It's now a real Fluent-managed Script Include:
`src/fluent/script-includes/aiReadabilityScorer.now.ts` + `aiReadabilityScorer.server.js`.

The `$id` in the `.now.ts` (`Now.ID['x_snc_kb_refinery_ai_readability_scorer-script-include']`) is
manually mapped in `src/fluent/generated/keys.ts` to the record's *original* sys_id
(`e7c19b292b4f0f10ba6df7ddfe91bf15`), rather than letting the build generate a fresh one — this
makes a deploy **update** the existing instance record instead of creating a duplicate. Confirmed
via a local `pnpm run build`: the generated `dist-metadata/app/update/` file is named
`sys_script_include_e7c19b292b4f0f10ba6df7ddfe91bf15.xml` (the original sys_id, not a new GUID),
with `name: AIReadabilityScorer` and the full script body intact — no second record produced.
**Not yet verified against a real `now-sdk install`** — only the build output has been checked
locally; confirm on an actual deploy that this updates the existing record cleanly rather than
erroring, before treating this as fully proven.

This is the general pattern for adopting *any* instance-side-only record into Fluent without
duplicating it: pre-seed the exact key string in `keys.ts` with `table` + the real `id` *before*
the `.now.ts` file that references `Now.ID['<that same key>']` is built — `KeysRegistry` looks up
an explicit key by its literal string plus table, and reuses the existing `id` verbatim if found,
only generating a fresh random GUID when no matching entry already exists. Do this for any other
record adopted this way (e.g. a Scripted REST endpoint) rather than assuming the SDK will figure
out the mapping on its own from a matching name.

Once moved under `src/fluent/script-includes/`, the file is linted for the first time (it was
outside `src/fluent/**` before) — see this repo's lint output for any pre-existing issues in the
algorithm surfaced by that, unrelated to the migration itself.

## `eslint.config.mjs`'s Fluent server-script globals block also covers cross-script-include references

Beyond genuine Glide-platform globals (`Class`, `GlideRecord`, etc.), the same
`src/fluent/**/*.js` globals block in `eslint.config.mjs` also needs an entry for every custom
script include's class name that's referenced *from a different* `.server.js` file. Each Script
Include name is a real global at runtime (Glide script includes share one global namespace), but
ESLint lints every file in isolation with no knowledge of sibling files — so a call like
`HTMLToMarkdownLib.translate(...)` from `refineryOrchestrator.server.js` is a genuine `no-undef`
false positive unless `HTMLToMarkdownLib` is declared in that globals block, same reasoning as the
pre-existing `Class` entry. Add a new entry there for every new script include that gets called
from any other `.server.js` file (not needed for one only called from `.now.ts`/page/widget code,
or one that's entirely self-contained).

## ~~`x_snc_kb_refinery_job.status` covers both "running vs. done" and "which phase"~~ (superseded 2026-09-03)

There used to be a separate `current_stage` choice field (`converting`/`analyzing`/.../`completed`)
alongside a 3-value `status` (`running`/`completed`/`failed`). Folded into one field: `status` now
holds all of `converting`/`analyzing`/`deduplicating`/`enriching`/`rescoring`/`scoring_enriched`/
`completed`/`failed` directly, since the phase values are all "running," just at different points
(`scoring_enriched` added 2026-09-02 — see the "Call 1 dispatched 3 times" note below). The job-lock guard
(`RefineryOrchestrator.run`) checks `status NOT IN (completed, failed)` rather than a single
`running` value — don't reintroduce a separate stage field without re-checking that guard.

**Superseded 2026-09-03**: a single job-level phase field couldn't represent articles genuinely
progressing at different rates within the same job (an article with no gap Finding finishes after
analyzing, while a sibling with one keeps going through enrichment) — see the new
"Per-article status now lives on `x_snc_kb_refinery_job_item`" note below for the actual current
design. `Job.status` itself is coarse again now (`pending`/`running`/`completed`/
`completed_with_errors`/`failed`) — this is the opposite direction from what this note describes,
not a further evolution of it. The job-lock guard now checks
`status NOT IN (completed, completed_with_errors, failed)`.

## ~~`RefineryLLM` calls a Now Assist Skill that doesn't exist yet — every dispatch is a placeholder~~ (resolved 2026-09-02)

`src/fluent/script-includes/refineryLLM.server.js`'s `CAPABILITY_ID`/`SKILL_CONFIG_ID` constants
used to be literal `'TODO_PLACEHOLDER_...'` strings. The real "Knowledge Refinery" Now Assist Skill
now exists on the instance (`sn_nowassist_skill_config`, Claude Opus/Sonnet via Bedrock) and these
are wired to its real, confirmed IDs (`c2b82f393b8f83106479ff7e53e45aa0` /
`a2b8af393b8f83106479ff7e53e45ad3`) — every phase's batch dispatch goes through this one function,
so this was a single-file fix. Kept here for context; `RefineryOrchestrator.run()` still has no
caller of its own (see the manual-run-trigger work, if/when it lands).

## `RefineryJsonUtil` is a deliberate local copy of the platform's `AIGCAgentHelper` pattern, not a cross-scope dependency

`RefineryLLMCallback` needs to strip a ` ```json ... ``` ` fence from a model reply before
`JSON.parse`-ing it. The platform has its own helper for this in AI Group Chat's scope
(`AIGCAgentHelper.safeJSONParse`/`stripResponseEnclosures`) — but that lives in a *different*
application scope, and reaching into another scoped app's script include as a bare global is the
same kind of cross-scope coupling this app avoids everywhere else (see the `sys_amb_processor`
note elsewhere in this file, and `glide-platform-facts.md`'s note on scope-qualified names). So
this app has its own copy instead: `src/fluent/script-includes/refineryJsonUtil.now.ts` +
`.server.js`, a plain static-style script include (`RefineryJsonUtil.safeJSONParse`/
`.stripResponseEnclosures`) with the exact same logic, owned entirely by this app's scope. **Don't
"simplify" this back into a direct `AIGCAgentHelper.*` call** — that would reintroduce the
cross-scope dependency this was written to avoid, for no real benefit (the logic is a handful of
lines, cheap to keep in sync manually if the platform's own version ever changes).

## `RefineryJsonUtil.safeJSONParse` never throws — `RefineryLLMCallback` detects a parse failure by `typeof`, not by catching an exception

The old regex-based `RefineryLLM.parseJsonReply` threw on invalid JSON, and
`RefineryLLMCallback.processCompleted` relied on a `try/catch` around it to detect a bad reply.
`RefineryJsonUtil.safeJSONParse` (and therefore the current `parseJsonReply`, which delegates to
it) **never throws** — on a parse failure it just returns the original raw string unchanged. Every
prompt template's own schema always replies with a JSON *object*, never a bare string/number, so
`processCompleted` now checks `typeof parsed !== 'object'` right after calling `parseJsonReply` and
treats that as the failure signal instead of a caught exception. If you ever touch this call site
again, don't reintroduce a `try/catch` as the *only* failure-detection mechanism — it will silently
stop catching anything, since nothing throws anymore.

## `now-sdk transform` re-adds two invalid fields to every prompt template record — strip them with `docs/examples/strip-prompt-template-boilerplate.mjs`

Every `x_snc_kb_refinery_prompt_template_*.now.ts` file's `data` object can end up with
`sys_customer_update: 'false'` and `sys_replace_on_upgrade: 'false'` added after a `now-sdk
transform` pull from the instance. These are real `sys_metadata` fields on the underlying table
conceptually (`x_snc_kb_refinery_prompt_template` extends `sys_metadata`), but the table's own
Fluent schema only declares `name`/`template` — so the generated `Data<...>` type doesn't include
them, and the build fails with `TS2353: Object literal may only specify known properties` on all
four files at once.

Run `node docs/examples/strip-prompt-template-boilerplate.mjs` from the project root after every
`now-sdk transform` to strip both fields back out before building — it's a plain line-filter over
every `x_snc_kb_refinery_prompt_template_*.now.ts` file in `src/fluent/data/record/`, safe to
re-run any time (a no-op once already clean).

## Neither `now-sdk transform` nor `now-sdk install` reconciles — use `pnpm run sync:transform` instead of a bare `transform` when you have undeployed local edits

Both directions of this app's fluent sync are blind overwrites, not diffs: `now-sdk install`
pushes source's field values onto the instance regardless of any manual instance-side edit, and
`now-sdk transform` regenerates source files straight from the instance regardless of any
undeployed local source edit. Running a bare `transform` while you have uncommitted/undeployed
fluent source changes silently discards them.

`pnpm run sync:transform` (`scripts/sync-transform.sh`) turns the `transform` direction into a
real git 3-way merge instead: it commits a fresh instance pull against a tracked
`fluent-transform-baseline` tag, then `git merge`s that into your branch. A field you changed in
source and a field someone changed on the instance, on different lines, merge automatically; only
a field genuinely touched on **both** sides since the last sync surfaces as an ordinary git merge
conflict — which side should win is a judgment call about intent, so that part is deliberately left
to you, not automated. Requires a clean working tree to start (commit local edits first). The
`install` direction has no equivalent safeguard — if you need to preserve an instance-side edit
before deploying, sync it into source (via this script) before running `deploy`/`deploy:reinstall`.

## `now-sdk transform` can resurrect a field that was deliberately dropped from the schema, if the instance column was never actually dropped (2026-09-05)

A bare `transform` run pulled `x_snc_kb_refinery_job.pending_work`,
`.pending_batch_count`, and `.current_stage` back into `job.now.ts` —
all three were explicitly removed from the design during the
2026-09-03 job-item redesign (see "Per-article status now lives on
`x_snc_kb_refinery_job_item`" below and the two "superseded" notes
above it). The instance's own `sys_dictionary` rows for these columns
were apparently never dropped after that refactor shipped, so
`transform`'s blind instance→source copy faithfully re-added them —
this is the same class of blind-overwrite risk the `sync:transform`
note above describes, just surfacing as *stale* data rather than
*conflicting* edits. Removed again from source; if this keeps
recurring, the actual fix is dropping the three columns on the
instance itself, not re-removing them from source after every
transform.

## `RefineryOrchestrator.run()`'s first real caller: the home page's manual run trigger

`RefineryOrchestrator.run()` was dead code with no caller until `widgets/pipeline-run-launcher`
(button + KB-article search/multi-select picker, mounted on `pages/home/page.js`) was added.
`run()`/`_runConvertingPhase()` now take an optional `articleSysIds` array — when given, the
converting-phase query is `sys_id IN <ids>` instead of the usual `active/published/updated-in-2-
years` batch query, and deliberately does **not** re-apply those filters (a user who explicitly
picked these exact articles has already made that call). This is also the first code path to ever
set `Job.triggered_by` — previously declared on the schema but never written anywhere.

~~**The manual trigger is not exempt from the existing single-job-in-flight lock** — `run()`'s guard
(`status NOT IN (completed, failed)`) applies identically whether the caller is the eventual
scheduled batch job or this button.~~ (superseded 2026-09-03, see below)

Picking 2+ articles in the picker is a legitimate way to deliberately exercise the
`deduplicating` phase, which a true single-article run can never reach (nothing to compare
against).

**Superseded**: the manual trigger *is* now deliberately exempt from the single-job-in-flight
lock. `run(articleSysIds, force)`'s `force` flag (surfaced in the article picker as the
"Reprocess even if unchanged since last run" checkbox, checked by default) wraps the guard itself
(`if (!force) { ...check for an in-progress job... }`), not just the unchanged-since-last-run skip
in `_prepareAnalysis` — one flag now does both jobs. The "Refine articles" button on
`pages/home/page.js` no longer disables itself based on job status at all (the `jobStatus`
prop/`_busy` getter were removed from `widgets/pipeline-run-launcher`) — a user can always open
the picker and start a run, regardless of whether one is already in progress. See
`refineryOrchestrator.server.js`'s own `run()` doc comment for the authoritative, up-to-date
description of this.

## ~~`pages/pipeline`'s real-data stage bucketing is a Job.status-driven approximation, not an exact per-article state machine~~ (superseded 2026-09-03)

**Superseded**: `pipeline-data.js`'s `bucketArticle()` now sources its primary bucket from real
`x_snc_kb_refinery_job_item.status` (per-article, per-job, real-time) instead of the `Job.status`
approximation this whole section describes — the `no_gaps`/`no_evidence` overlay checks below are
the one piece that survived unchanged, now layered on top of a real `completed`/`failed` Job Item
status instead of a `Job.status`-inferred one. Kept below for the historical reasoning (why the
naive `pipeline_stage`-only approach doesn't work, and the specific ambiguity `bucketArticle()`
still can't resolve, both still true).

`pages/pipeline/pipeline-data.js`'s `bucketArticle()` assigns each of a run's articles to one of
the page's pre-existing 6 ring + 3 exit ids. The naive approach — read it straight off
`Analysis.pipeline_stage` — doesn't work: `RefineryOrchestrator._prepareAnalysis` sets
`pipeline_stage` to `'analyzing'` immediately on creation, during the synchronous **converting**
phase, and never sets any other value until `'ready'` on successful rescoring. So
`pipeline_stage` alone can only ever distinguish "not started" / "still in progress somewhere" /
"done" — never which of `converted`/`analyzed`/`enriching`/`synthesizing` an article is actually
in.

The actual signal used is primarily **`Job.status`** (which phase the whole run is in — a
`JOB_STATUS_TO_STAGE` lookup), with three per-article overrides layered on top once the relevant
whole-job phase has passed (findings only exist once `analyzing` has fully finished for the job;
`enrichment_knowledge` only reliable once `enriching` has fully finished):
- `pipeline_stage === 'ready'` → `ready`, regardless of `Job.status` (this article's own rescoring already succeeded, independent of whether other articles in the same batch are still processing).
- No gap-type Finding at all, once analyzing has finished for the whole job → `no_gaps`.
- A gap-type Finding exists but `enrichment_knowledge` was never set, once enriching has finished for the whole job → `no_evidence`.

**Known, accepted gaps, not bugs to fix**: `deduplicating` has no dedicated ring on this page (folded into `analyzed`, matching the plan's own documented decision). `Analysis.pipeline_stage`'s `restructuring`/`validating` choices are dead — nothing ever writes them (see the `x_snc_kb_refinery_job.status` note above for the analogous `Job` case). This bucketing is inherently a whole-job-phase approximation, not a true per-article state machine — an article can show as "still enriching" on screen for a little while after its own individual batch item has actually already resolved, if other articles in the same job are still mid-batch. Don't try to "fix" this without adding a real per-article progress field to the schema (see the job tracker widget's own analogous note on `x_snc_kb_refinery_job.status` having no per-phase progress total).

**Partially addressed 2026-09-02**: the specific complaint this section used to describe as accepted — an article whose `pipeline_stage` sits at `'analyzing'` forever with nothing distinguishing "still working" from "this is as far as it got" — now has a real fix on the `Analysis` record itself: a new `pipeline_stage: 'failed'` ("Finished with Errors") value, written by `RefineryOrchestrator.handleBatchFailure` (any substantive-phase LLM/dispatch failure) and by `_handleEnrichingResult`'s "insufficient incident coverage" skip branch. **This page's own `bucketArticle()` was deliberately left unchanged** — it already buckets the insufficient-coverage-skip case more specifically as `no_evidence` (via its existing `hasGap && !enrichment_knowledge` check), and a blanket `pipeline_stage === 'failed'` check would have overridden that with a less informative generic `failed` bucket. So `bucketArticle()` still has no signal for a genuine analyzing-phase failure distinct from `no_gaps` (a real article that legitimately has no gap findings) — that pre-existing ambiguity is untouched. The new value is authoritative on the `Analysis` record directly (list views, the record form); it just isn't (yet) wired into this page's bucket computation.

## `pages/pipeline`'s live-article list uses `Analysis.standardized_summary`/`kb_knowledge.short_description` as title, and `X-Total-Count` for a live source count

Two small technique notes from wiring `pipeline-data.js`, worth keeping in mind for any similar client-side page-data module:
- The platform's Table API (`/api/now/table/<table>`) returns an `X-Total-Count` response header reflecting the *full* matching row count, independent of `sysparm_limit` — used for `_source()`'s live "active + published kb_knowledge" count via a `sysparm_limit=1` request, avoiding a second round trip just to count rows.
- Analysis rows don't carry the article's own title/category directly (`source_record` is a polymorphic id, not a resolved reference Table API can dot-walk) — resolved via a second `kb_knowledge?sysparm_query=sys_idIN<ids>` fetch, joined client-side by `sys_id`. Don't assume `kb_knowledge_base` (a real reference field on Analysis) is a substitute for the article's own category — it's the knowledge base, not the KB category the original hardcoded demo data actually showed.

## `RefineryLLM.dispatchBatch` also accepts a chat-history payload shape, unused by any real call site yet

Confirmed live (see `docs/examples/`): the "Knowledge Refinery" Skill accepts an alternate payload
shape, `{__chat_history: [{role, content: [{type: 'text', text}]}]}`, alongside the normal
`{prompt: '...'}` one-shot shape. `RefineryLLM.dispatchBatch` items may now optionally set
`chatHistory` instead of `promptText` to use it. No phase in `RefineryOrchestrator` sets
`chatHistory` today — every real call stays a fresh, single-turn prompt, matching this app's
existing "separate conversation per call, not continuous history" design decision (see
`plan.md`'s LLM Calls section). This is purely a future-proofing hook, added cheaply while the
dispatch code was already being touched.

## Pipeline orchestration is async, batched, and callback-driven — not one synchronous run

`RefineryOrchestrator.run()` only does the **converting** phase synchronously (find-or-create
Analysis, raw/converted Snapshots, link check — no LLM calls). Every phase after that
(analyzing/deduplicating/enriching/rescoring) batches up to `LLM_BATCH_SIZE` prompts into one
`executionRequests` array via `RefineryLLM.dispatchBatch`, `mode: 'async'`, and returns — the
script execution ends there. `RefineryLLMCallback.processCompleted`/`processErrored`/
`processCancelled` (registered as `callbackHandler: 'x_snc_kb_refinery.RefineryLLMCallback'`)
receive results in a **later, separate script execution**. This means:

- **No in-memory state survives between dispatch and callback**, or between two different phases'
  callbacks. An earlier version of this pipeline held Call 2's structured output in a static
  in-memory map (`RefineryOrchestrator._pendingCall2Result`) to hand it to the rescoring phase —
  that doesn't work once dispatch and result-handling are different script executions. Fixed by
  persisting it on `Analysis.enrichment_knowledge` (JSON) instead. Any new cross-phase or
  cross-batch hand-off needs to go through a real table field, never a static in-memory variable
  on a script include.
- **Progress tracking lives on the Job record**, not in a loop variable: `Job.pending_work` (JSON
  queue, popped from on every dispatch) and `Job.pending_batch_count` (decremented by the callback
  as results arrive). `RefineryOrchestrator.onBatchItemsResolved(jobSysId, count)` is the single
  place that decides whether to dispatch the phase's next chunk or advance
  (`RefineryOrchestrator.enterPhase`) to the next phase.
- **Correlation is entirely via each execution request's own `meta.user_data`** — there is no
  platform-provided request-id/correlation field (checked; none exists in any type stub or
  example found for this API). Every `_build*Item` function in `RefineryOrchestrator` attaches
  whatever that phase's result-handler will need (e.g. `{jobSysId, phase, analysisSysId}`, or for
  the pairwise dedup phase `{jobSysId, phase, analysisSysIdA, analysisSysIdB}`).

## Confirmed batching contract: one callback, N keyed results, per-item `user_data`

Live-tested (client-side, by the app owner — "I assume it will be similar server side," not yet
re-confirmed server-side): sending N entries in `executionRequests` produces **one**
`processCompleted` call whose `response.result` has N keys, each carrying its own `.meta.user_data`
and `.result.response`/`.result.message` — the exact same per-key shape
`AIGCSkillCallback.extractSkillData` already assumes for its own (always single-item) calls, just
with more than one key present. `RefineryLLMCallback._extractResultItems` loops over
`Object.keys(response.result)` on this basis — **not** a guess dressed up as one of several
speculative shapes; this is the confirmed one. If a real server-side batched call ever contradicts
this (e.g. per-item `user_data` doesn't survive, or the shape differs from the client-side test),
update `_extractResultItems` and this note together.

## `RefineryLLMCallback` must define its methods on `prototype`, not as static properties on the constructor

`RefineryOrchestrator` and `RefineryLLM` in this app both use a
`Class.create()` shell with an empty `prototype` (just `initialize`/
`type`) and every real method attached directly to the constructor
function (`RefineryOrchestrator.run = function () {...}`), because both
are only ever called directly (`RefineryOrchestrator.run()`,
`RefineryLLM.dispatchBatch(...)`) with no `new` anywhere in this codebase
— that pattern is internally consistent for them.

**`RefineryLLMCallback` is different and must NOT follow that same
pattern**, because it isn't called by this app's own code — it's invoked
by the platform via `callbackHandler: 'x_snc_kb_refinery.RefineryLLMCallback'`
(see `refineryLLM.server.js`), the same Now Assist Skill callback-handler
contract `AIGCSkillCallback` uses. That contract instantiates the class and
calls instance methods (`processCompleted`/`processErrored`/
`processCancelled` on the prototype), matching `AIGCSkillCallback`'s own
shape — a static property on the constructor function is never seen by
that path, so a `RefineryLLMCallback.processCompleted = function...`-style
definition wouldn't just be a style mismatch, it would make the callback
silently unreachable. Fixed 2026-09-02 by moving all of
`processCompleted`/`processErrored`/`processCancelled`/`_handleFailure`/
`_resolveCounts`/`_extractResultItems` onto `RefineryLLMCallback.prototype`
(cross-calls between them now go through `this.`, not the constructor
name) — internal calls to `RefineryOrchestrator.*`/`RefineryLLM.*` stay
as-is since those two are correctly static-style per the above.

**Lesson**: don't copy a "sibling script include's" static-vs-prototype
shape onto a new one without first checking *how that new one is actually
invoked* — a platform callback-handler contract can require the
class/instance shape even when every other script include in the same
app uses the static-function shape.

## `eslint.config.mjs`'s Glide-globals block didn't cover `widgets/**` at all

The `src/fluent/**/*.js` globals block only listed `files: ['src/fluent/**/*.js',
'components/**/server-script.js']` — no `widgets/**` glob at all. Confirmed
this was a real, pre-existing gap, not something specific to a new widget:
linting the already-shipped `widgets/aiux-hello-world/server-script.js`
directly (`npx eslint widgets/aiux-hello-world/server-script.js`) failed with
`'GlideDateTime' is not defined (no-undef)` even though that file predates
this finding and is genuinely correct code. Fixed by adding `widgets/**/
server.js` and `widgets/**/server-script.js` to that block's `files` array
(both naming conventions exist in this app — the old widget uses
`server-script.js`, `@server('./server.js')`-declared widgets use
`server.js`). Any widget server script written before this fix would have
silently been failing lint the whole time with no one noticing, since
lint-on-save/CI presumably wasn't run against that specific file in
isolation.

## `broken_links_found` on Job is declared but never actually incremented anywhere

`x_snc_kb_refinery_job.broken_links_found` (`job.now.ts`) has a real
dictionary entry, a default of `0`, and a spot on the record's default form
layout — but grepping the whole `src/` tree for the literal string
`broken_links_found` turns up only the column declaration and its own form-
layout reference, no write anywhere in `refineryOrchestrator.server.js` or
any other script include. `_checkLinks` (mentioned elsewhere in this file)
implements link validation and creates `broken_link`-type Findings, but
never touches this specific Job-level counter. Any UI built against this
field (a job tracker/dashboard tile, etc.) will show a truthful `0` for
every real job today — that's not a bug in the UI, it's this counter simply
never being wired up on the write side. Wire it into wherever
`_checkLinks`'s broken-link Findings are created if this counter is meant
to go live, rather than assuming the UI is broken if it stays at zero.

## The platform's built-in AMB Record Watcher needs no app-side pub/sub setup — but depends on the orchestrator's incremental `jobGr.update()` calls (partially superseded 2026-09-03 — see below)

Building a live-updating job tracker (`widgets/job-progress-tracker`) raised
the question of whether a custom `sys_amb_channel`/`sys_amb_processor` needed
to be authored for `x_snc_kb_refinery_job`. It doesn't. Confirmed by reading
`@servicenow/aiux/aiux-components-core`'s actual source
(`components/core/src/amb-service.js`, `amb-controller.js`) rather than
assuming: `AMBService.subscribeToRecordWatcher(table, query, callback)`
builds a generic `/rw/{actionPrefix}/{table}/{base64(query)}` channel for
*any* table — this is a core platform mechanism, not something that needs
per-table provisioning. So `AMBController.setRecordWatchers([{table:
'x_snc_kb_refinery_job', query: 'sys_id=<id>'}], cb)` from a widget is
sufficient on its own; no new Fluent AMB records, no Business Rule, and none
of the scope-qualified-name/`accessibleFrom: 'public'` gotcha documented
elsewhere in this repo's copied `glide-platform-facts.md` (that gotcha is
specific to *custom* `sys_amb_processor` authorization/listener scripts,
which this doesn't use).

**The real dependency this creates**: live tracking only works because
`RefineryOrchestrator`/`RefineryLLMCallback` write to a watched table at
multiple points *within* a run rather than once at the very end. If a
future change collapses those into fewer/later updates (e.g. to reduce
database writes), the record watcher will simply have less to fire on — no
error, the tracker just goes quiet between whichever updates remain. Keep
this in mind before "optimizing" the orchestrator's own update frequency.

**Superseded 2026-09-03**: the specific mechanism described above (`jobGr.update()`
calls on every `enterPhase`/batch dispatch/`pending_batch_count` decrement) no
longer exists — `Job.status` is coarse now and only changes 2-3 times per run
(`pending`→`running`→a terminal value). The general lesson (AMB needs something
to fire on) still holds, but the actual watched, frequently-updated table for
real-time per-article progress is now `x_snc_kb_refinery_job_item` — every
widget/page that needs live per-article updates watches *that* table (in
addition to Job, for the coarse start/finish transitions), not Job alone. See
the "Per-article status now lives on `x_snc_kb_refinery_job_item`" note below.

## ~~`x_snc_kb_refinery_job.status` values have no per-phase progress total in the schema~~ (superseded 2026-09-03)

Every phase after `converting` (`analyzing`/`deduplicating`/`enriching`/
`rescoring`/`scoring_enriched`) batches work via `pending_work` (JSON queue, popped from) and
`pending_batch_count` (outstanding results for the in-flight chunk only) —
there is no field recording "how many items entered this phase in total."
The job tracker widget approximates a phase's total population as
`articlesProcessed` (the converting phase's final count, which is fixed for
the rest of the job) and derives `done = articlesProcessed - pending_work.length
- pending_batch_count` to render a real (completed/in-flight/queued)
segmented breakdown instead of a fabricated single percentage — deliberately
not exact, since dedup/skip drops within a later phase aren't separately
counted anywhere. If a future phase needs an exact per-phase total, that
needs a new field set once in `enterPhase`, not something derivable from the
current schema.

**Superseded**: `pending_work`/`pending_batch_count` are gone — see the new
"Per-article status now lives on `x_snc_kb_refinery_job_item`" note below.
The exact per-phase-total problem this note describes is now moot: every
Job Item row already carries an exact, real status, so there's no
"approximate total minus outstanding count" math needed anywhere any more —
a page just counts real rows grouped by real status.

## Per-article status now lives on `x_snc_kb_refinery_job_item`, not `Job.status` (2026-09-03)

The whole-job phase field (`Job.status` holding `converting`/`analyzing`/
`deduplicating`/`enriching`/`rescoring`/`scoring_enriched`) is gone. `Job.status`
is coarse now: `pending`/`running`/`completed`/`completed_with_errors`/`failed`.
A new table, `x_snc_kb_refinery_job_item`, has one row per (job, article) —
created for every article a job looks at (including a `skipped` one, so
counts always reconcile to `articles_total`), with its own `status`:
`pending`/`converting`/`analyzing`/`enriching`/`scoring`/`completed`/`failed`/
`skipped`. `scoring` covers both the rewrite call and the immediately-following
re-score-of-the-rewrite call — no checkpoint between them. Deduplication has no
dedicated status: `RefineryOrchestrator._checkForDuplicates` runs it as a
side-channel off every `analyzing` result (comparing against every other
already-analyzed item in the same job, any batch), and it never gates or
delays that item's own status.

**Batching changed shape too.** `RefineryOrchestrator._startJob` assigns a
`batch_number` to every Job Item at creation (`LLM_BATCH_SIZE` per batch) and
runs `_runConversionStage` once per batch, synchronously, dispatching each
batch's `analyzing` call and moving on to the next batch without waiting —
batches (and therefore articles) genuinely progress independently from that
point on, driven by whichever LLM callback happens to land first. There is no
more job-wide `pending_work`/`pending_batch_count` bookkeeping: each callback
just dispatches the next stage for whichever items it resolved (collected via
`_queueForDispatch`/`onBatchItemsResolved`, flushed once per callback), relying
on the confirmed fact that one dispatch's results all land in one
`processCompleted` call.

**Job finalization is a decremented counter, not a re-derived whole-job
aggregate (revised again 2026-09-03).** The first cut of this called a
`_checkJobFinished` after *every* terminal Job Item write, re-counting
`completed`/`failed`/`skipped` Job Items across the *whole job* each time
and comparing against `articles_total`. Replaced because that's a real,
if narrow, race: many independent callback invocations (one per terminal
article, potentially a dozen-plus for a 10-article job) could each read a
stale cross-batch snapshot and each independently decide "not done yet"
even when, taken together, the job actually was — with nothing left to
ever re-check afterward.

**Current design**: `Job.remaining_batches` (Integer) is set to the total
batch count once, in `_startJob`. `RefineryOrchestrator._checkBatchFinished(jobSysId,
batchNumber)` — called from the same trigger points the old whole-job
check was (end of `_runConversionStage`, end of `onBatchItemsResolved`,
the per-batch failure safety net in `_startJob`) — checks only *that one
batch's* Job Items via `GlideAggregate`; if all have reached a terminal
status, it calls `_decrementRemainingBatches`, which decrements
`remaining_batches` by 1 and, once it hits 0, runs `_finalizeJob` exactly
once (the same `completed`/`completed_with_errors`/`failed` derivation
the old check did, just run a single time instead of repeatedly).

This doesn't provide a mathematically atomic decrement — GlideRecord
doesn't expose one to scoped-app scripts, so two batches' completions
racing at the exact same instant could still under-count by one. But it
shrinks the collision surface from "every terminal article write, across
the whole job" down to "at most once per batch" (typically 1-2 times for
a default-sized job), and batches are already naturally staggered in time
since `_startJob` processes them one after another. Accepted as a much
narrower, much lower-probability residual than before, not a claim that
the race is impossible.

Every job/pipeline page's counters now group by real Job Item status
(`GlideAggregate` server-side in the widgets, client-side reduction in
`pages/pipeline/pipeline-data.js`, matching that page's existing
loader+`aiuxFetch` convention) instead of approximating from `Job.status`.
`pages/home/page.js`'s rail also switched to a `stageIndexFromCounts()`
derived from real Job Item counts (`current-job.js`'s `fetchJobItemCounts`)
— a single representative "leading edge" position, not a literal per-item
visualization, since a one-orb rail can't show five articles at five
different stages at once.

## `Snapshot.token_count`, computed via `sn_generative_ai.TokenCalculator`, needed a new `eslint.config.mjs` platform-namespace global

Added 2026-09-02: `x_snc_kb_refinery_snapshot.token_count` (`snapshot.now.ts`) tracks token count for
all three snapshot types (raw/converted/enriched), wired into `RefineryOrchestrator._writeSnapshot`
via a new `RefineryOrchestrator._getTokenCount(content)` helper, following the exact same
"clamp/guard at the single write site" discipline as `score`/`llm_score`/`word_count` etc.
documented elsewhere in this file.

`_getTokenCount` lazily instantiates `sn_generative_ai.TokenCalculator()` **once** and caches it on
`RefineryOrchestrator._tokenCalculator` — not a fresh `new TokenCalculator()` per call — mirroring
how every other cross-call helper in this file avoids repeated construction cost on a hot path
(`_writeSnapshot` runs 3+ times per article per run).

Like `sn_one_extend`/`sn_ws` before it, `sn_generative_ai` is a platform API namespace global that
needed adding to `eslint.config.mjs`'s `src/fluent/**/*.js` globals block — ESLint has no idea it's
a real Glide-provided global otherwise, and flags it `no-undef` even though the code is correct.
Same pattern as every other platform-namespace addition in this file: check
`eslint.config.mjs`'s existing "Platform API namespaces" comment block before assuming a new
`sn_*`/`sys_*` global needs some other fix.

## Every table's `actions.read` flipped from `false` to `true` (2026-09-02)

All 8 tables that had `actions: {read: false, ...}` (`job`, `eval_question`, `evidence`,
`finding`, `snapshot`, `mention`, `product`, `analysis`) now have `read: true` — `prompt_template`
already had it. Per `glide-platform-facts.md`'s general note (`Table()`'s `actions` field only
gates Table API access, nothing to do with ACLs), this only turns on `GET
/api/now/table/<table>` for these tables; it does **not** change who can actually read rows — the
28 `Acl()` records already granted the `x_snc_kb_refinery.user` role real read access regardless
of this flag (see `docs/security.md`, `docs/tables.md`). Don't confuse "the Table API endpoint now
responds" with "ACLs changed" if this surfaces during debugging later.

## `eslint.config.mjs`'s Fluent server-script globals needed `Class` added

The `src/fluent/**/*.js` block in `eslint.config.mjs` declares Glide
server-script globals (`GlideRecord`, `gs`, `current`, etc.) for lint
purposes, but was missing `Class` — so a brand-new `Class.create()`-style
Script Include's `.server.js` file failed lint with `'Class' is not
defined (no-undef)` even though the code was correct. Fixed by adding
`Class: 'readonly'` to that globals block (see the block's other Glide
globals for the pattern). If a similar `no-undef` false-positive shows up
for another real Glide global in a `.server.js`/`.now.ts`-adjacent script
file, add it to the same block rather than sprinkling
`eslint-disable`/`/* global */` comments per-file.

## `raw`/`enriched` are scored via the literal `kb_article_analysis` prompt, dispatched a 2nd and 3rd time — not two separately-worded prompts (2026-09-02)

Two designs were tried and rejected for scoring `raw` and `enriched` snapshots before landing here
— worth knowing so a future session doesn't reintroduce either:

1. **`raw` fully non-LLM** (the original design) — no `llm_score` for `raw` at all, by design. Ruled
   out because it meant there was no genuine three-stage `llm_score` comparison at all, only the
   mechanical `score`.
2. **A separate, narrower prompt per stage** (`raw_content_quality`, asking only for
   `quality_score`; `article_synthesis` self-scoring its own rewrite via a one-line paraphrase of
   Call 1's rubric) — ruled out because a differently-worded prompt, even scoring the identical
   content, isn't guaranteed to land on the same score a full Call 1 response would: what else the
   model is asked to produce in the same completion can shift the number. This defeated the actual
   point of the exercise (a genuine apples-to-apples 3-point comparison), even though it looked like
   it solved the "raw has no score" complaint.

**What's actually in place now**: the literal `kb_article_analysis` prompt (Call 1) is dispatched
**three times per article** — against `raw` (during `analyzing`, alongside the real converted-
content dispatch — `RefineryOrchestrator._buildRawScoringItem`), against `converted` (the "real"
invocation whose full response is persisted to `Analysis`/`Finding`/`Mention`), and against
`enriched_content` once Call 3 (`article_synthesis`, now rewrite-only) has produced it, in a brand
new `scoring_enriched` phase (`RefineryOrchestrator._buildEnrichedScoringItem`/
`_handleEnrichedScoringResult`) inserted into `PHASE_ORDER` right before `completed`. Only
`quality_score` is kept from the `raw`/`enriched` invocations — the findings/search_terms/
target_audience/summary/product_mentions those responses also produce are discarded, since
persisting them would create duplicate/conflicting `Finding`/`Mention` rows describing content
that isn't the article's current (converted) state.

**Consequences worth knowing**:
- This is strictly more LLM calls than either prior design — 3 dispatches of Call 1 per article
  now, plus a whole new async dispatch/callback round-trip (`scoring_enriched`) that the job
  doesn't reach `completed` without. Accepted deliberately; don't "optimize" this back down to one
  shared score or a narrower prompt without re-reading the two rejected designs above.
- `Analysis.pipeline_stage` now only flips to `'ready'` in `_handleEnrichedScoringResult`, not
  `_handleRescoringResult` — the enriched snapshot's `llm_score` is deliberately left `null` by
  `_handleRescoringResult` and picked up by `_computeWorkItems('scoring_enriched')`'s own query
  (`type='enriched' AND content IS NOT NULL AND llm_score IS NULL`, deduped by `parent`). If you
  ever add another way to write an `enriched` snapshot, make sure it either sets `llm_score`
  itself or leaves it null so this phase picks it up — a snapshot that never gets either treatment
  leaves that article stuck one phase short of `'ready'` forever, the same class of bug
  `pipeline_stage: 'failed'` (see `handleBatchFailure` in `refineryOrchestrator.server.js`) exists
  to avoid elsewhere.
- `pages/home/page.js`'s `RAIL_STAGES`/`stageLabel` and `pages/pipeline/pipeline-data.js`'s
  `JOB_STATUS_TO_STAGE`/`bucketArticle`'s `enrichingDone` check all needed a `scoring_enriched`
  entry too — any future new phase needs the same three-place update (this file's `job.now.ts`
  choice list is the fourth place, plus this note and `docs/plan.md`/`docs/tables.md`/
  `docs/architecture.md`'s phase enumerations).
- Reused the `kb_article_analysis` prompt's own `{{content}}` placeholder for all three
  invocations (renamed from `{{markdowncontent}}`, since it's no longer markdown-only) — the
  `incident_enrichment` prompt's own separate `{{markdowncontent}}` placeholder is unrelated and
  was left as-is.

## Verbose `gs.info()` instrumentation in the enriching phase (2026-09-02)

`_buildEnrichingItem`/`_handleEnrichingResult` in `refineryOrchestrator.server.js`, and all of
`RefineryIncidentSearch.findCandidates`, carry ~20 `gs.info()` calls (tagged `[Refinery][Enrich]`/
`[Refinery][IncidentSearch]`) added to debug a real "should have found incidents but didn't" case
— logging the category/search-terms/encoded-query at each search layer, the candidate incidents
found, the full prompt sent, the raw LLM response, and a per-incident relevancy verdict. Left in
place deliberately rather than reverted once the immediate debugging session ended — this phase
has no other visibility into *why* an article ends up in `no_evidence`, and the same class of
question ("why didn't it find incidents this time") is likely to come up again for a different
article. Filter the system log by either tag to trace one run's incident-search + relevancy path
end to end.

**One specific thing this instrumentation was added to surface, not yet confirmed either way**:
`_buildEnrichingItem` passes `kbGr.getValue('category')` (`kb_knowledge.category`) straight into
`RefineryIncidentSearch.findCandidates`, which filters `incident.category` by it. `kb_knowledge`'s
categorization is normally `kb_category` (a reference to a different table), not a plain
`category` choice field sharing `incident.category`'s value set — if `kb_knowledge.category`
returns a non-blank value that doesn't match any real `incident.category` choice, every incident
gets filtered out before search terms are even considered, silently. The new logging's
`category="..."` line makes this checkable directly from a real run's log output; hasn't been
confirmed against a live instance either way yet.

## KB article content extraction moved to `RefineryKbContent` (2026-09-03)

The class-name-dispatched logic for pulling a KB article's real body
text — plain `kb_knowledge.text` vs. a `kb_template_*` subclass's own
rich-text fields — used to live only inside `RefineryEvalScorer`
(`_rawTextFor`/`_templateTextFor`), an ad hoc/manual tool not called by
the pipeline. `RefineryOrchestrator` and `AIReadabilityScorer` each read
`kb_knowledge.text` directly instead and have **no** subclass handling of
their own — so a templated article's real content was silently invisible
to the actual pipeline and to the readability scorer, even though the
eval tool could see it correctly.

Extracted into a new shared script include,
`src/fluent/script-includes/refineryKbContent.now.ts` +
`.server.js` (`RefineryKbContent.getText(kbClass, kbSysId, baseGr)`), so
any caller gets the same dispatch instead of each re-implementing (or
omitting) it. `RefineryEvalScorer` now delegates to it.
`RefineryOrchestrator`/`AIReadabilityScorer` were **not** changed to use
it yet — they still only read the plain `text` field. If a templated
article ever needs to flow correctly through the real pipeline/scorer,
those two need to be pointed at `RefineryKbContent.getText` too; this
was deliberately left out of scope for the initial extraction.

Also added a second subclass this dispatch didn't previously cover:
`u_kb_template_esc_kb_template_faq` (an FAQ-style article). Its content
isn't a body field at all — it's 15 question/answer field pairs
(`u_kb_question_1`/`u_kb_answer_1` .. `u_kb_question_15`/
`u_kb_answer_15`). `RefineryKbContent._faqTextFor` walks all 15 by
number, skips a pair whose *question* is blank (the answer field itself
is never checked), and renders each kept pair as `Question: <q>\nAnswer:
<a>`, pairs joined by a blank line. Like the `kb_template_*` classes,
this needs its own subclass-typed re-query (`new
GlideRecordSecure(kbClass)`) to see its own fields — the passed-in
`baseGr` (typically a plain `kb_knowledge` GlideRecord) can't see them.

Per this file's own earlier note on `eslint.config.mjs`'s
cross-script-include globals block: `RefineryKbContent` was added there
too, since `RefineryEvalScorer.server.js` now references it as a
cross-file global.

## First AI Agent in this app: `src/fluent/agents/kb_search_demo_agent.now.ts` (2026-09-03)

This app's first `AiAgent()` Fluent record — a demo agent with a single
RAG Search (`type: 'search_retrieval'`) tool. Introduces a new `agents/`
category folder under `src/fluent/`, alongside `tables/`, `roles/`,
`acls/`, `script-includes/`, `rest-apis/`, `nav/`, `data/` — follow the
same one-concern-per-file, snake_case-filename convention for any further
agent/tool/workflow `.now.ts` files. (The generic `type: 'search_retrieval'`
vs. the bundled SDK docs' `type: 'rag'` gotcha is SDK-wide, not
app-specific — it lives in `.claude/rules/environment-build-deploy.md`'s
Fluent metadata section instead.)

Config choices made for this demo agent, worth knowing before extending
it:

- **Auth**: Dynamic User (Caller-Privilege) via `dataAccess.roleMap:
  ['user']` — not an AI User service account.
- **Invocation ACL** (revised 2026-09-05): `'Specific role'`, restricted
  to `snc_internal` (role sys_id `7fcaa702933002009c8579b4f47ffbde`) —
  internal ServiceNow staff only. Originally `'Any authenticated user'`
  with no role list; tightened directly on the instance and pulled back
  into source via `now-sdk transform`. If you ever see this ACL drift
  back to `'Any authenticated user'` after a future `transform`, that's
  the instance's own record having been reverted, not a source bug —
  reconcile deliberately rather than assuming either side is "right" by
  default.
- **Search profile**: `quick_action_kb_search_profile` (sys_id
  `0d6e994dc30101103f4fcd7b7940ddf6`) — a real, published, active
  `ais_search_profile` on this instance, scoped to a single search source
  ("All Knowledge Articles", `datasource: kb_knowledge`).
- **Semantic index**: `body`
  (`ais_semantic_index_configuration.semantic_field_name` on
  `kb_knowledge`) — chosen over the sibling active indexes `title` and
  `kbRagFields` on the same table; `kbRagFields` is scoped to a different,
  specific app and should not be reused here.
- **No trigger** — manual invocation only, via Agent Playground / Now
  Assist Panel (Otto).

## `Snapshot.version` — the pipeline-run number, threaded across the async phase boundary (2026-09-03)

Added an Integer `version` field to `x_snc_kb_refinery_snapshot`: 1 on an
article's first run, 2 on its second, etc. — shared by the `raw`/
`converted`/`enriched` trio one run produces. Exists because "latest row
per `(parent, type)`" (the append-only table's original, sole notion of
"current" — see `tables.md`) isn't a strong enough guarantee on its own:
if a run's enrichment fails, reducing per type independently can pull
that run's `raw`/`converted` together with an *older* run's `enriched`
row, with nothing to signal they're not from the same run. `version`
gives every consumer an exact-match filter instead.

Two new helpers on `RefineryOrchestrator`, both in
`refineryOrchestrator.server.js`:

- `_nextSnapshotVersion(analysisSysId)` — `GlideAggregate` COUNT of this
  Analysis' existing `type='raw'` rows, + 1. Called **once**, in
  `_phaseA_converting`, before that run's `raw` Snapshot is written, and
  the same value is reused for the `converted` write immediately after —
  both are in the same synchronous call, so there's no cross-phase
  hand-off needed for these two.
- `_currentSnapshotVersion(analysisSysId)` — reads the version back off
  the run's own `raw` Snapshot (via the existing `_latestSnapshot`
  helper) rather than recomputing it. Needed because the `enriched` write
  sites (`_handleEnrichingResult`'s skip branch, `_handleRescoringResult`)
  run in a **later, separate async callback script execution** — see this
  file's own "Pipeline orchestration is async, batched, and
  callback-driven" note above; there's no in-memory version value left
  over from `_phaseA_converting` to reuse. Reading "latest raw" back is
  safe specifically because `RefineryOrchestrator.run()`'s job-lock guard
  never allows a second run to start for the same Analysis while one is
  still in flight — so the latest `raw` row at `enriched`-write time is
  always *this* run's own, never a newer run's that snuck in ahead of it.

**If a fifth write site for `enriched` (or any new Snapshot type) is ever
added, it needs the same `_currentSnapshotVersion` call** — there's no
default/fallback that makes a missing `version` obviously wrong at write
time (it would just be `null`/unset on that row), and a consumer filtering
by exact `version` match (see `kb-refinery-pages.md`'s analysis-report
fetch) would simply never find that row.

## `RefineryLLM.dispatchSync` (2026-09-03) — a synchronous call added alongside `dispatchBatch`, for the unrelated EmployeeWorks chat mockup

`refineryLLM.server.js` gained a second entry point, `dispatchSync(item)` +
`_extractSyncText(response)`, for `widgets/chat-thread` (see
`docs/employeeworks-chat.md` for the full feature writeup — a standalone
chat mockup, not part of the pipeline). `dispatchBatch`'s own async +
`RefineryLLMCallback` round trip doesn't fit a "user hits send, wants a
reply in the same turn" call site, so this uses `mode: 'sync'` + plain
`sn_one_extend.OneExtendUtil.execute()` (not `executeSecure`, and no
`callbackHandler`) against the same real "Knowledge Refinery" skill
instead.

**The request shape is confirmed working — but only against a different
skill/capability in a different app on this instance**, not yet against
this app's own skill. `_extractSyncText` therefore tries the confirmed
sync-shape (`response.capabilities[capId].response`), then falls back to
this app's own confirmed *async*-path shape
(`response.result[key].result.response`/`.message`, the same one
`RefineryLLMCallback._extractResultItems` uses), then a bare top-level
`response.response`/`.message`, and `gs.warn`s the raw response if none
match rather than guessing. Simplify this to whichever shape turns out to
be right once a real chat turn has actually round-tripped against
`surfuat2` — don't leave the fallback chain in place past that point, it
exists only for the window where the real shape is unknown.

`chatHistory`/`__chat_history` (dispatchBatch's other payload shape, see
above) was deliberately **not** reused for `dispatchSync` — it's confirmed
for the async path only, and stacking a second unverified variable
(payload shape *and* response shape, both unconfirmed for sync) on top of
an already-unverified response format wasn't worth it. The chat widget
instead builds one full `promptText` string per turn (history + RAG
context + question all as text), reusing this app's one fully-confirmed
round trip.
