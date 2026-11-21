---
paths:
  - "widgets/**"
---

# kb_refinery — widgets notes

Findings specific to this app's own widgets (this app's data/business-logic
choices for a given widget, not generic AIUX widget-authoring conventions —
those live in the copied `widget-and-page-conventions.md`/
`karuna-component-integration.md` template files; see the root `CLAUDE.md`
for why generic platform knowledge lives there instead of here). Companion
to `kb-refinery-pages.md` (its own `paths:` frontmatter scopes it to
`pages/**`, so it wouldn't load in a widgets-only session) — split out the
same way, per `rules/README.md`'s own guidance, since this maps cleanly onto
its own directory (`widgets/**`).

## `widgets/product-word-cloud` — home page word cloud of mentioned products (2026-09-03)

Reads `x_snc_kb_refinery_product` directly (`name` + `article_count`,
filtered to `article_count > 0`, ordered desc, capped at the top 60 — no
join through `x_snc_kb_refinery_mention`). `article_count` is exactly the
field `tables.md` calls out as a "maintained counter for fast dashboard
tiles" — this widget is the first real consumer of that design intent.

Confirms, in this app, that the generic "Highcharts inside a karuna-based
app" pattern from `karuna-component-integration.md` actually works
end-to-end for a series type (`wordcloud`) the platform's shared
`Highcharts()` mixin doesn't support: `highcharts` core plus the
`wordcloud`/`accessibility` ESM modules are dynamically `import()`ed
together from one call site (`_loadHighcharts()`), triggered from
`firstUpdated()` — never `connectedCallback()`, which also runs during
SSR and has no DOM to draw an SVG word cloud into anyway. Confirmed via
the build's own bundle-size report that this actually code-splits into
separate lazy chunks (`chunks/highcharts-*.js` ~268KB,
`chunks/accessibility-*.js` ~133KB) rather than inflating either the
always-loaded client bundle or the widget's XML-embedded SSR isolate
bundle, and the widget's generated `sys_aix_widget` records came out a
normal size (tens/low hundreds of KB, not multi-MB) — no
source-got-inlined bug (see `environment-build-deploy.md`'s "Verifying a
deploy actually landed").

`highcharts` was added as a **direct** `package.json` dependency, pinned
to `12.6.0` — the exact version already resolved transitively via
`@servicenow/aiux` at the time this was added (checked with `find
node_modules/.pnpm -maxdepth 1 -iname 'highcharts@*'` before adding it,
same lever `environment-build-deploy.md`'s Highcharts section describes).
If `@servicenow/aiux` is ever upgraded, re-check whether its own
transitive `highcharts` version moved, and re-pin to match — a
mismatched version here wouldn't break the "share one instance" trick
itself (that only needs both imports in this widget's own bundle to
resolve to the *same* file, not to match whatever version karuna's own
externalized `Highcharts()` mixin uses elsewhere), but a needless second
copy of the library in the dependency tree is still worth avoiding.

The chart's SVG is `aria-hidden`, paired with a visually-hidden `<ul>`
text equivalent of the same product/count list (WCAG 1.1.1) — plus a
`@media (forced-colors: active)` block pinning `forced-color-adjust:
none` on the chart container specifically. Highcharts paints via inline
SVG attributes, which forced-colors mode leaves alone by default (unlike
author CSS) — but the word size/color *is* the content for a sighted
forced-colors user, unlike the sr-only list, which only serves assistive
tech. Any future chart-shaped widget in this app should default to this
same pairing rather than assuming "forced-colors doesn't touch SVG" means
nothing needs to be written for it.

**Not yet confirmed in a browser against real instance data** — verified
via `pnpm run lint`/`pnpm run build` only so far (see
`docs/architecture.md`'s own note on this same gap for the rest of the
home page). In particular, this widget renders nothing informative if
`x_snc_kb_refinery_product` has no rows with `article_count > 0` yet.

## ~~`widgets/chat-launcher` — don't hand-build a `${path}?q=...` string for `navigate()`~~ (superseded 2026-09-03 — see below)

Its send handler originally called `navigate(\`${CHAT_PATH}?q=${encodeURIComponent(text)}\`)`
— embedding the query string directly into the `path` argument, instead
of this app's own already-proven `navigate(path, {query: {...}})` shape
(`pages/job-tracker/page.js`'s `_writeSelectedJobToUrl`). Switching to
`navigate(CHAT_PATH, {query: {q: text}})` did **not** fix the underlying
"Page not found" — see below for what actually did, and what that implies
about this fix (harmless, matches this app's proven `navigate()` call
shape, but wasn't the real cause).

## `/chat` 404'd as a second page; the fix was to stop being a second page (2026-09-03)

Full diagnostic trail, condensed. Symptom: navigating from `pages/ask` to
a brand-new `pages/chat` route produced a genuine server-side "Page not
found" (`{"redirect": "/aiux/kb_refinery/page-not-found"}` from a
`route-resolve`-style fetch — a 200 response, not a failed request, just
one saying the route doesn't exist) even after a full rebuild + `now-sdk
install --reinstall` + confirming on the instance that `sys_aix_page`,
its widget, and its `sys_aix_experience_page_rel` all existed. Ruled out,
each with a concrete check, not just a guess:

- **Not the hand-built query string above** — fixing it changed nothing.
- **Not a missing/dropped record** — `pages/chat`'s `sys_aix_page`/
  `sys_aix_experience_page_rel` were diffed byte-for-byte-equivalent
  against `pages/ask`'s own (same shape, same experience id, same
  `sys_policy`), and confirmed present on the instance.
- **Not an oversized/malformed widget XML** (the known "silently dropped
  during install" failure mode documented in `environment-build-
  deploy.md`) — every `sys_aix_widget_*.xml` for this feature parsed as
  valid XML and was a normal tens-of-KB size, chat-thread's included.
- **Not the global AIUX runtime cache** (`$AIUX_REPO_ROOT/.aiux-runtime`)
  either — that failure mode breaks *every* route, not just the newest
  one; this affected `/chat` alone while `/ask` kept working throughout.

**What actually resolved it**: mounting `<chat-thread>` directly on
`pages/ask` (no second page, no `navigate()` at all) worked immediately,
first try, with zero other changes. That's not a fully explained root
cause — nothing above proves *why* a second brand-new page route
specifically fails while the records for it look correct — but it's a
strong enough signal that the final design (see `docs/employeeworks-
chat.md` and the `pages/ask` note in `kb-refinery-pages.md`) uses one
page with a client-side widget swap (`chat-launcher:submit` event) rather
than a second page, and doesn't chase this further. **If a future feature
needs a genuinely new page route in this app, don't assume this was a
one-off** — budget time to hit the same wall, and check back here first.

## `widgets/pipeline-run-launcher`'s article-picker query: no filter → `workflow_state='published'` → `kb_knowledge.latest` (2026-09-03)

The `searchArticles` action's `kb_knowledge` query went through three
states in one day, worth keeping the full trail for rather than just the
final shape:

1. **Original (as first wired up)**: `addActiveQuery()` only, no
   `workflow_state` filter at all — deliberate, per its own comment: a
   `workflow_state='published'` filter is what the picker used to have,
   and it left the picker empty on a knowledge base full of draft/review
   articles. `RefineryOrchestrator.run(articleSysIds)`'s own manual path
   doesn't re-apply the active/published/2-year filters either (see
   `kb-refinery-domain.md`'s "first real caller" note), so this kept the
   two consistent.
2. **Briefly**: `gr.addQuery('workflow_state', 'published')` added back,
   per an explicit ask to stop showing non-published articles.
3. **Current**: replaced with `gr.addQuery('latest', true)`, once the
   actual complaint was named precisely — it was never really about
   `workflow_state`, it was that a revised article's **older versions**
   were showing up alongside its current one. A revised `kb_knowledge`
   article is multiple separate rows sharing one `number` (one per
   version); `workflow_state` alone can't reliably pick out "the current
   one," since a superseded version's own `workflow_state` is whatever it
   was left in at supersession (often `published`, right up until the
   newer version supersedes it) — filtering on it doesn't dedupe versions
   at all. `latest` does: confirmed via `@servicenow/sdk-core`'s bundled
   `kb_knowledge.now.d.ts` type stub (not guessed) to be a real,
   platform-maintained, `readOnly: true` boolean (`default: true`),
   flipped to `false` automatically on every version once a newer one
   supersedes it. Filtering on it means "exactly one row per article
   number, whichever is current" — independent of that current version's
   own `workflow_state` (draft/review/published all pass, matching state
   1's original reasoning above, just via the right field this time).

`addQuery('latest', true)` is kept as its own top-level call, before the
term-search OR-group (`short_description LIKE term OR number LIKE
term`) — same "AND filters as separate top-level `addQuery()` calls, then
one OR'd group of its own" nesting `refineryIncidentSearch.server.js`'s
`findCandidates` already established as this app's working pattern for
this shape, so `latest` ANDs against the *whole* OR-group rather than
only its first half.

Search-by-title needed no fix at all — `short_description` (this table's
real title field; there's no separate `title` field on `kb_knowledge` in
this app) was already OR'd with `number` in the existing term query.

## Known issues (template placeholder)

Use this section, in this file, for open or resolved-but-worth-remembering
findings specific to this app's own widgets — following the same "resolved
items kept, struck through, for context" convention as the rest of this
knowledge base.
