---
paths:
  - "pages/**"
---

# kb_refinery — pages/frontend notes

Findings specific to this app's own pages (routing/loader/data-fetching
technique for *this* app, not generic AIUX page/widget conventions — see
the root `CLAUDE.md` for why generic platform knowledge lives in the
copied `.claude/rules/` template files instead of here). Companion to
`kb-refinery-domain.md` (that file's own `paths:` frontmatter scopes it to
`src/fluent/script-includes/**`/`eslint.config.mjs`, so it would never
load in a pages-only session) — split out per `rules/README.md`'s own
guidance, since this maps cleanly onto its own directory (`pages/**`).

## `pages/analysis-report/[sysId]` — dynamic-segment report page, loader + aiuxFetch, no widget needed

Added 2026-09-02: a Regular (SSR) page keyed by an Analysis record's own
sys_id (`pages/analysis-report/[sysId]/page.js`, route
`/analysis-report/:sysId`), reading `ctx.params.sysId` in `static async
loader(ctx)`. Follows the same loader+`aiuxFetch`-against-the-Table-API
pattern already established by `pages/pipeline/pipeline-data.js`
(`pages/incidents/page.js` was a second example of it, until that page was
deleted 2026-09-02), rather than a widget+`server.js` — this is
read-only report content with no need for `GlideRecordSecure`'s row-level
enforcement beyond what the Table API's own ACLs already provide, and the
loader pattern keeps this page consistent with every other page in the
app instead of introducing a new widget just for this.

Own, page-scoped data module (`analysis-report-data.js`) rather than
sharing one with `pipeline-data.js` — matches this app's existing
convention (see `pipeline-data.js`'s own header comment) of never sharing
a fetch helper module across page directories, even though the documented
hazard it's guarding against is specifically about *widget* client
bundles.

### Snapshot fetch is version-filtered, not "latest per type" (updated 2026-09-03)

`x_snc_kb_refinery_snapshot` is append-only (see `tables.md`) — a real
article can accumulate many historical rows per `type` across reruns.

This page originally reduced to "latest per type" independently: one
metadata-only pass (`sysparm_fields=sys_id,type,processed_at`, no
`content`, to avoid downloading every historical row's up-to-4MB content
just to throw it away) ordered by `ORDERBYDESCprocessed_at`, taking the
first row seen per type; a second pass then fetched full content for
those (at most 3) rows by sys_id. **This was replaced** because it's not
actually safe — a run whose enrichment failed and an *older* run's
`enriched` row could get shown side by side with the failed run's own
`raw`/`converted`, with nothing to signal they weren't from the same run.

The current version (`fetchLatestVersion` + `fetchSnapshotsForVersion` in
`analysis-report-data.js`) fetches the max `version` off this Analysis'
`type='raw'` rows (one query, `sysparm_fields=version`,
`ORDERBYDESCversion`, `sysparm_limit=1`), then fetches every Snapshot row
matching that exact `version` in one query
(`parent=<id>^version=<n>`, `sysparm_limit=3`, full
`SNAPSHOT_CONTENT_FIELDS`) — no per-row `getRecord` round trips needed,
since filtering by the exact version already narrows the query to the (2
or 3) rows actually wanted. Ordered by `version` rather than
`processed_at`: `version` is an integer assigned specifically to encode
run order (see `tables.md`'s Content Snapshot section and
`RefineryOrchestrator._nextSnapshotVersion`/`_currentSnapshotVersion` in
`kb-refinery-domain.md`), whereas `processed_at` is only
second-precision and a run's own raw/converted rows are written
back-to-back synchronously — version is the more reliable ordering
signal, not just an equally-valid alternative.

### `sysparm_display_value=all` wraps *every* field, including `sys_id` — and a dot-walked field lands as a flat, literally-dotted key

Two Table API behaviors worth remembering for any future page/widget doing
a similar fetch, confirmed by building this page's data shape end to end:

- With `sysparm_display_value=all`, every field in the response —
  `sys_id` included — comes back as `{value, display_value}`, not a bare
  string. A list-query result's own `sys_id` needs `.value`, same as any
  other field; easy to forget since `sys_id` reads like it should just be
  a plain string.
- A dot-walked field in `sysparm_fields` (e.g. `last_job.status`) does
  **not** nest under the reference field in the response — it lands as
  its own top-level key literally named `'last_job.status'`. Accessing
  `analysis.last_job.status` (nested) silently reads `undefined`;
  `analysis['last_job.status']` is the real path. Used here to pull the
  job's `status`/`error_message`/`started_at`/`completed_at`/
  `triggered_by` onto the single Analysis fetch, instead of a second
  round trip to `x_snc_kb_refinery_job`.

### Content is rendered, not diffed — markdown/HTML rendering is client-only via dynamic `import()`

`components/analysis-content-viewer.js` lets the user pick 1–3 of
raw/converted/enriched to view side by side, each one actually rendered
(raw is stored HTML, rendered as-is; converted/enriched are stored
Markdown, run through `marked`) and sanitized (`dompurify`) before
injection via `unsafeHTML` — not a diff/text-comparison view (explicitly
descoped mid-implementation) and not a `<pre>` block showing raw
markdown/HTML source.

This is the second real use, in this app, of the pattern already
documented in `environment-build-deploy.md` (a dynamic `import()` of a
browser-only library gets stubbed out of the SSR isolate bundle; a static
top-level import does not) — the first writeup there was widget-internal.
Confirms the pattern generalizes to a page-level component too, not just
widgets: both `marked` and `dompurify` are dynamically `import()`ed from
`firstUpdated()` (never `connectedCallback()`/`render()`), never
statically imported at module top level, and the `_selected` stage
picker's default/pruning logic runs in `willUpdate()` (which does run
during SSR) precisely so the picker/grid shape is right on first paint
even though the actual rendered content can't appear until hydration.

New dependencies: `marked` (markdown → HTML) and `dompurify` (sanitize).
No diff library was added — an earlier pass of this same page's plan
called for one (`diff`/jsdiff), but the requirement changed
mid-implementation to a plain side-by-side rendered viewer with no diff
computation at all. Don't reintroduce one without checking whether the
requirement has actually changed back.

## `pages/pipeline`'s tunnel stage detail is real, one-article-at-a-time content (2026-09-03)

`page.js`'s `_stages()` used to hand `<pipeline-tunnel>` a fixed, fabricated
"printer troubleshooting" `desc`/`example` per stage (see `architecture.md`'s
Frontend-shell note history) — real counts everywhere else on the page,
static illustrative copy in the one place that claimed to show "what
happens here." Replaced: an article selector (`<pipeline-tunnel>`'s new
`articles`/`selectedArticleId` props, a plain `<select>` in its top control
row, firing `pipeline-tunnel:article-select` with `{id}`) lets the page pick
**one** real article from the current job, and every one of the six stages'
`example.in/out` is that same article's own real content/output at that
step — threaded through, not independently sampled per stage.

- `pipeline-data.js`'s new `fetchArticleDetail(analysisSysId)` fetches that
  one article's full history (not scoped to the current job): the three
  Snapshot rows (content/score/llm_score/broken_link_count) belonging to
  this Analysis' single latest run, every Finding, and — for any
  content-gap Finding — the matched Evidence rows (dot-walked
  `incident.number`/`incident.short_description`, same gotcha as
  `analysis-report-data.js`) plus `Analysis.enrichment_knowledge` (parsed
  JSON: `ai_ready_knowledge.{conditions,actions,escalation_criteria}`,
  each an array of `{condition|step|criterion, source_incidents}` — see
  `refineryOrchestrator.server.js`'s `_knowledgeToText` for the
  authoritative field names).
- **First landed reducing Snapshot rows to "latest per `type`"
  independently, the exact anti-pattern this same file's own "Snapshot
  fetch is version-filtered, not latest per type" note (above, from
  `analysis-report-data.js`) already documents as unsafe** — caught during
  a post-implementation doc/consistency pass, not at review time, which is
  exactly the "don't trust prior code as verification, re-check against the
  documented gotcha" lesson this repo's own `.claude/rules/glide-platform-
  facts.md` opens with, just for a client-side fetch bug instead of a Glide
  API one. Fixed to mirror `fetchLatestVersion`/`fetchSnapshotsForVersion`'s
  two-step pattern exactly: find this Analysis' latest `version` off its
  `type='raw'` rows (`ORDERBYDESCversion`, limit 1), then fetch Snapshot
  rows filtered by that *exact* `version` — never a per-type reduction —
  so a run whose enrichment failed can't show that run's raw/converted next
  to an older run's enriched row with nothing to signal they're not from
  the same run. Findings/Evidence are deliberately **not** version-scoped,
  matching `analysis-report-data.js`'s own `fetchFindings` precedent exactly
  (no `version`/`last_job` filter there either) — don't add one here
  without first checking whether that precedent itself still holds.
- `pickDefaultArticleId(articles)` (also `pipeline-data.js`) picks whichever
  article in the run actually reached `ready`, so the default view has real
  content for every stage rather than mostly empty states; falls back to
  the first real article, or `''` when the run has none.
- A stage with `example: null` renders `stage.emptyMessage` instead (added
  to `pipeline-tunnel.js`'s `_renderStageDetail`) — e.g. "This article
  hasn't been converted yet." — rather than leaving the pane blank or
  silently falling back to demo content. Get the truthiness check order
  right for a stage whose empty-state reasoning branches on more than one
  real fact (the `enriching` stage checks `detail` itself before
  `detail.hasGap`, specifically so a still-loading detail — `detail ===
  null` — never gets misread as "confirmed this article had no gap").
- `_loadOverview()` always calls `_loadArticleDetail(this._selectedArticleId)`
  on every refresh (including every AMB-triggered one), not just when the
  selection changes — the selected article's own real content can advance a
  stage between two refreshes, same "just refetch on any signal" policy the
  rest of this page already uses for `_handleJobChange`.
- Content blocks (raw HTML/Markdown, up to 4,000,000 chars per
  `tables.md`) are capped client-side (`previewContent()`, 1200 chars) before
  being handed to the tunnel's `kind: 'code'` example side — the `<pre>`
  block's own `white-space: pre-wrap` already renders real embedded
  newlines, so a single-element `lines: [previewContent(content)]` array is
  enough; no need to split on `\n` first.
- Also corrected two `desc` inaccuracies the fabricated version had
  papered over: the conversion step HEAD-checks *external* hyperlinks only
  (relative links are skipped — `_checkLinks`'s own `/^https?:\/\//i` test),
  and the enriched snapshot's `llm_score` comes from a **separate**
  `scoring_enriched` phase's own dispatch of the literal `kb_article_
  analysis` prompt against the rewrite — Call 3 (`article_synthesis`)
  itself no longer self-scores (see `kb-refinery-domain.md`'s "raw/enriched
  are scored via the literal kb_article_analysis prompt" note).

## `pages/pipeline/components/article-diff-dialog.js` is now dead code — not deleted, just unwired

`pages/pipeline/page.js`'s article-row click used to open this dialog
(hardcoded demo diff content, never wired to real Snapshot rows — see
`docs/architecture.md`'s prior Frontend-shell note). As of 2026-09-02 it
navigates to the real `/analysis-report/<id>` page instead, and the
dialog's import/state/render usage was removed from `pipeline/page.js`.
The dialog's own file was deliberately left in place rather than deleted
— its two-panel `grid-cols-2`/highlight-span CSS is still a reasonable
visual reference if a real computed-diff view is ever built later — but
nothing in the app imports it any more. Don't be surprised it exists with
no call site; it's intentionally orphaned, not an oversight.

## `pages/home/page.js`'s "Articles" table was a remaining hardcoded-demo-data holdout, missed by an earlier "all wired to real data" claim

`docs/architecture.md`'s Frontend-shell note claims `pages/home`/
`pages/pipeline` (and, at the time, `pages/incidents`) are "all wired to
real data now" — true
of the job-status rail and the pipeline stats/counts/list, but
`pages/home/page.js`'s own "Articles" table (`_articles()`) was still six
hardcoded demo rows the whole time, a narrower gap that blanket claim
glossed over. Fixed 2026-09-02: replaced with `analysis-list.js`, a real
`x_snc_kb_refinery_analysis` fetch (10 most-recently-updated rows), joined
against latest-per-type Snapshot scores using the same `latestByParent`-
style reduction `pipeline-data.js` already established for exactly this
shape — each row links to `/analysis-report/<sys_id>`. ~~The KPI tiles and
health/readability distribution donuts above it are still hardcoded — not
touched by this pass, and not claimed otherwise here.~~ — resolved by
deletion rather than by wiring, 2026-09-02 (see below).

## `pages/home`'s hardcoded score UI was deleted rather than wired, and the refine action became the page's focal element (2026-09-02)

Both health/AI-readability distribution cards (`_distributions()` and the
`_renderDonut()` SVG helper) and three of the four KPI tiles (`Avg. health
score`, `Avg. AI readability`, `Needs attention`) are gone — every one was
hardcoded demo data with no real query behind it. `Total articles` stays
(also still hardcoded, as is the h1's own "across 1,248 knowledge
articles" subtitle — don't read its survival as evidence it's real).

In their place, `<pipeline-run-launcher>` moved out of a small right-
aligned row above the rail card into a `.cta-panel` — a `color-mix()`
primary-hue wash + corner bloom sharing the rail's own glow language,
paired with the `Total articles` tile in a 3-column row (panel takes 2).
The widget's own button is deliberately **not** an `.aiux-btn` any more
but a bespoke `.cta` pill (gradient fill, sheen overlay, coloured lift
shadow) living in the widget's shadow root, since the panel surface and
the button were designed against each other. Both carry flat-token
fallbacks declared before their `color-mix()`/gradient layers, plus
`prefers-reduced-motion` and `forced-colors` blocks.

Copy is now "Refine articles" everywhere (button, dialog title, page
headline); the dialog's confirm reads "Start refining".

## `pages/home/page.js` navigates straight to `/pipeline` once a manual run starts (2026-09-03)

`_handleRunStarted` (fired by `pipeline-run-launcher:started`, see its own
widget-side notes in `kb-refinery-widgets.md`) now calls
`navigate(PIPELINE_PATH)` right after wiring up the AMB watchers for the
new job — no query param carrying the job id, and none needed:
`pages/pipeline/pipeline-data.js`'s own `fetchCurrentJob()` already
resolves to "the most recent job still in flight, else the most recent of
any status" with no id argument at all, and the job `startRun` just
created is always exactly that (freshest `sys_created_on`, `status:
'running'`) the instant this navigation lands. If a future need calls for
linking to a specific *non-current* job (a past run, not the live one),
that's `pages/job-tracker`'s existing `?job=<sysId>` pattern
(`SYSPARM_JOB`/`_writeSelectedJobToUrl`) — `/pipeline` still has no such
param wired in, and this change didn't add one.

This isn't a new page route (`/pipeline` already existed and was already
reachable from this same page via `_openPipeline`), so it doesn't run into
the `/chat`-style 404 documented in `kb-refinery-widgets.md` — that
failure mode was specific to a brand-new route, not to `navigate()`
between existing ones.

## `pages/incidents` deleted (2026-09-02)

An `aiux-list-connected` list of active incidents, plus its own
`url-sync.js` (a page-scoped module that mirrored the list's state into the
URL query). It was scaffold-era demo furniture with nothing to do with the
refinery's own data, and its nav item in `application.js` went with it.

**Deleting the directory does generate real DELETE records — but into the
elective bucket, so an ordinary deploy won't apply them.** Verified
directly against this deletion's own `pnpm run build` output, not assumed:

- `src/fluent/generated/keys.ts` keeps all three `Now.ID` entries
  (`aiux-page|`/`aiux-page-widget|`/`aiux-experience-page-rel|
  x-snc-kb-refinery-incidents-page`), each now tagged `deleted: true` —
  the registry doesn't forget an id just because its source is gone.
- `dist-metadata/app/author_elective_update/` gained a genuine
  `action="DELETE"` record for each (`sys_aix_page_<id>.xml`,
  `sys_aix_widget_<id>.xml`, `sys_aix_experience_page_rel_<id>.xml`),
  each a bare `sys_id` + `sys_scope` + `sys_update_name`.
- Nothing for these ids appears in `dist-metadata/app/update/` (the main
  install path) — the build's page count also drops 5 → 4.

This is the same elective, opt-in bucket `environment-build-deploy.md`
already documents for a removed `.now.ts`, so the same caveat applies: a
plain `pnpm run deploy` is very likely **not** enough to actually remove
the `sys_aix_page` / `sys_aix_widget` / `sys_aix_experience_page_rel` rows
from an instance that already had this page installed. Expect the route to
stop being reachable from the nav while the records linger; use the
update-set/configuration install mode, or delete them by hand on the
instance, if they need to genuinely go.

## ~~`pages/ask` + `pages/chat` — two pages~~ (superseded 2026-09-03 — see `pages/ask` single-page note below)

Originally two pages, nav item "EmployeeWorks": `pages/ask` (search-box
landing) navigating to `pages/chat` (multi-turn thread) via
`navigate('/chat', {query: {q}})`. `pages/chat`'s `loader()` read `?q=`
and seeded `<chat-thread>`'s `initialQuestion` prop via the same one-time
`willUpdate()` + `_initialized`-flag pattern `pages/job-tracker/page.js`
uses for its own `?job=`. **Abandoned**: `/chat` 404'd on the deployed
instance ("page not found") despite its records checking out — see the
superseding note below for what replaced this and `.claude/rules/kb-
refinery-widgets.md` for the full diagnostic trail. Kept here only so a
future session doesn't reintroduce a second page as the "obvious" way to
add a step to this flow without knowing it already failed once.

## `pages/ask` — the EmployeeWorks chat mockup, single page, deliberately outside the pipeline (2026-09-03)

One page now, not two (see superseded note above for why). `pages/ask`
renders `<chat-launcher>` (greeting + search box) until it dispatches
`chat-launcher:submit`, then swaps to `<chat-thread .initialQuestion=...>`
in place — `_question` is the page's only state, no `loader()`/query
param involved at all any more. **Not part of the Knowledge Refinery
pipeline** — no `Analysis`/`Snapshot`/`Job` read or write, no AI Agent
Studio involvement. Full writeup in `docs/employeeworks-chat.md`.
