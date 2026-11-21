# Pages & Router

## Page-level decorators can silently no-op on `[param]` dynamic-segment pages

If a page-level decorator (`@roles`, `@order`, `@acl`, or a custom one you
patch in yourself — see `environment-build-deploy.md`'s Fluent metadata
section for the general "extend karuna via `pnpm patch`" pattern) reads
its argument by re-parsing the page's own source file at build time
(rather than from some other build-time-available representation), that
source lookup can silently fail — and silently fall back to a default —
for any page under a bracketed dynamic-segment route folder (e.g.
`pages/foo/[id]/page.ts`).

**Root cause** *(confirmed against `@servicenow/karuna` 22.50.0 — re-check
under a different version)*: the build's route-manifest step sanitizes
dynamic segments when computing each page's own `ssr` path key — e.g.
`[sys_id]` becomes `_sys_id_` — so that it's a valid-looking bundle
filename. A shared "read the original source for this page" utility that
every decorator reader goes through then does a naive
`path.join(projectRoot, 'pages', ssrPath)` lookup against **that
sanitized path** — which was never a real file on disk (the real file is
still at `pages/foo/[id]/page.ts`) — finds nothing, and throws.
**Each decorator reader's own `catch` swallows that failure into its own
default** (`[]` for a roles-style decorator, `undefined` for an
order-style one, `false`/`null` for a boolean/optional one) — **with no
build error, no warning, nothing surfaced anywhere.** The decorator looks
like it did nothing; there's no signal pointing at *why*.

This is easy to miss for a long time on a real project, because it only
bites pages under a dynamic-segment folder — a page decorator tried first
on a static-route page works fine, and the bug only surfaces once someone
tries the same decorator on a `[param]` page for the first time, however
long after the decorator itself was introduced.

**Fix, if you own a patch to the shared source-resolution utility**: after
the existing direct lookup fails, retry with each sanitized path segment
restored to its bracketed form (reverse whatever pattern the manifest
step used to sanitize it — e.g. `segment.replace(/^_(.+)_$/, '[$1]')` for
an underscore-wrapping scheme) before giving up. This is a genuine, general
latent bug fix, not scoped to whichever specific decorator you happened to
be adding when you found it — fixing the shared resolver unblocks every
decorator that goes through it, on every dynamic-segment page in the
project, not just the one you were testing.

**General lesson, even if you can't patch the resolver yourself**: don't
trust "the build didn't error" as evidence a source-reading, build-time
decorator actually took effect — verify it in the actual build output
(grep the generated page/metadata XML for the field the decorator is
supposed to set) the first time you use any such decorator on a page
under a dynamic `[param]` route folder, since that's exactly the
condition this class of bug hides behind.

## Regular pages vs. Composed pages

Two structurally distinct, mutually exclusive page-authoring models exist
in the karuna/Now SDK page model. Confirm which one a given SDK/karuna
version actually implements via direct source tracing before assuming
either model's behavior, not from a doc comment alone *(the following
was confirmed against `@servicenow/karuna` 22.50.0 — re-verify under a
different version)*:

| | Regular pages | Composed pages |
| --- | --- | --- |
| Base class | `AIUXElement` | `AIUXComposedPage` |
| Layout defined by | Lit `render()` method (code) | `static containers = [...]` (declarative tree, AST-parsed at build time) |
| Records generated | a page record, a page-widget record, a layout record | a page record, container records, widget-instance records |
| Page record's widget-pointer field | populated (points at the page's own widget) | **empty** |
| Rendering | SSR — page tag embedded directly in server HTML | CSR only — no server-rendered tag at all |

**The routing gate** is typically something like:
```js
const pageWidgetId = refValue(pageRecord.page_widget);
const isComposedPage = !pageWidgetId;
```
A page is only treated as Composed when its widget-pointer field is
empty. This is the literal trigger for container/widget-instance records
being read at all — a "container tree" build step, which is where a
generic "No layout configured"-style error string commonly originates on
an empty container tree. **Regular pages never reach any of this code.**
If you're debugging a "no layout configured"-style error on what should
be a Regular page, verify the page's widget-pointer field is actually
populated in the build output before assuming the Composed-page pipeline
is even involved — comparing against a manually-built Composed page for
diagnosis is apples-to-oranges if your actual page is Regular.

### Authoring a Composed page via Fluent (not manual-UI-only)

Composed pages don't require a visual page-builder tool — there's a real
Fluent path:

```ts
import {customElement} from 'lit/decorators.js';
import {AIUXComposedPage, decorators} from '@servicenow/aiux-components-core';
// Build-time scope hint ONLY for the AST scanner — never resolved/bundled
// at runtime. Lets the build derive a deterministic sys_id for the
// widget-instance record. The widget itself is still built and
// registered entirely by its own widget directory, same as any widget.
import '@servicenow/glide-widgets/<scope>/<widget-tag-name>';

const {title, roles} = decorators;

@customElement('my-composed-page')   // REQUIRED — the build fails without a
                                      // unique key for the page table without
                                      // it. Used as the page record's
                                      // identifier key; the actual rendered
                                      // tag is a DIFFERENT, server-synthesized
                                      // one.
@title('My Page')
@roles([])
export default class MyComposedPage extends AIUXComposedPage {
  static containers = [    // must be a literal — AST-parsed, not computed
    {
      classes: '',         // optional
      order: 0,            // optional, auto-assigned if omitted
      widgets: [
        {widget: '<widget-tag-name>', name: 'Display Name', classes: '', order: 0, properties: {}}
      ],
      containers: []        // optional nested child containers, same shape, recursive
    }
  ];
}
```

### Confirmed mechanism, with one real unresolved gap: initial-load CSR bug

The pipeline described above genuinely works end-to-end (build generates
correct container/widget-instance records, the instance's composed-page
bundle compiles and serves correctly, the widget's own bundle defines its
custom element correctly, and the page-tag global gets set correctly).

Despite that, **a Composed page can render blank on direct/initial
load** — no console errors, nothing thrown. Root cause, traced to the
core render-page logic (roughly):
```js
renderPage() {
  if (this._error) { ... }
  if (!this._hasNavigated) {
    return html`<slot></slot>`;   // ← returns here on first load, ignoring _currentPage
  }
  if (this._currentPage) {
    const pageTag = unsafeStatic(this._currentPage.tagName);
    ...   // this is what actually renders the page tag — never reached on first load
  }
}
```
The "has navigated" flag is only ever set `true` by an actual
client-side router navigation — never on a direct URL load or refresh.
The "current page" reference gets set correctly and early (specifically
so it's available on both SSR hydration and CSR first load, per that
code's own intent) — but the render method checks the navigation flag
*before* the current-page reference and bails to an empty slot
regardless. For Regular (SSR) pages this never matters, since their tag
is already in the server HTML and never depends on this reactive path at
all. For a Composed page (CSR-only by design), this is the *only* path
that could ever render its tag — and it doesn't fire on initial load.

**Untested prediction, not yet confirmed in every version**: landing on
any other (Regular, SSR'd) page first, then client-side-navigating to a
Composed page's route (not typing the URL directly, not refreshing)
should work, since that's what actually sets both flags together via
the router's navigate handler. If a project adopts Composed pages for
anything reachable via direct link/bookmark/refresh, confirm this
explicitly before relying on it.

### Dev server cannot render Composed pages at all — don't test them via the local dev server

The dev-serving path commonly has zero references to the Composed-page
concept at all — the manifest entry for a Composed page still carries a
flag recording that it *is* one, but nothing in the dev-serving path
branches on it. The build step that produces the real, renderable
synthesized bundle for a Composed page is typically only ever invoked
from the actual route-matching code the dev server never calls. So the
dev server will always render an empty shadow root for a Composed
page — that's a dev-server limitation, not evidence the mechanism is
broken. Test Composed pages directly on a deployed instance.

## Nav item clicks no-op when the target path matches where you already are

Symptom: clicking a nav item (e.g. "New Report", "New Dashboard") that
points at a route the current page has already mutated its own URL query
on (via `history.replaceState`) does nothing — you have to navigate to a
different page first, then back, for it to work.

Root cause: if a page writes something like `?sys_id=<id>` into the
address bar via `history.replaceState` after a save, the nav item's own
click handler only ever receives the nav item's `path` string — there is
typically no separate `query` field on a nav item's action. When that
path has no `?` in it, the navigation helper carries the **current**
URL's query forward rather than clearing it — so clicking that nav item
while already on `<path>?sys_id=X` computes the exact same target:
`<path>?sys_id=X`. The router then hits a same-path-same-query guard and
returns immediately: no loader re-run, no re-render, no history change.
From a *different* page, the current path differs, so the guard doesn't
fire and it works normally — matching the symptom exactly.

**Fix**: give the nav item's `path` an explicit trailing `?` (e.g.
`/foo-builder?` instead of `/foo-builder`). This flips the
navigation helper's branch: it parses the literal (empty) query after
`?` instead of merging the current query forward — so the nav item
always computes an explicitly empty query, which differs from the
current one and lets the router's guard clear correctly. This isn't a
hack; it's typically the only lever the navigation helper exposes for
"navigate here with no query," since nav item actions carry no separate
query field of their own.

**General lesson**: any nav item pointing at a route whose page mutates
its own URL (via `history.replaceState`/`pushState`) needs this same
trailing-`?` treatment, or clicking that nav item while already on that
route (with a non-empty query) will silently no-op.

## The router's own stale-while-revalidate data cache

The client router can maintain its own route-data cache (keyed by full
request path including query string, with a short TTL — commonly ~30
seconds) for stale-while-revalidate behavior on ordinary client-side
navigation — revisiting a cached route serves the stale snapshot
instantly, then revalidates in the background. This is a **separate
mechanism from the loader itself** — a page's own `loader()` can
genuinely re-run on every navigation with zero caching of its own, and
still have its result masked by this router-level cache serving a
pre-mutation snapshot first.

Symptom: creating/updating/deleting a record, then navigating to a
listing page that should show the new state, but seeing the old
(pre-mutation) list for up to the cache's TTL — a manual full-page
refresh (not a client-side nav) shows it correctly, since that bypasses
the cache entirely.

**Fix**: call the router client library's own cache-clearing function
(commonly named something like `clearRouteDataCache()`) right after every
successful create/update/delete action, before navigating away. Note
that this kind of router-internal client package often does **not**
resolve via plain Node `require.resolve` from the project root — it only
resolves at actual build/dev-server time via the bundler's own namespace
interception (the same mechanism documented under `AIUX_REPO_ROOT` in
`environment-build-deploy.md`). A failed `require.resolve` against it is
expected, not evidence the import is wrong.

This is a genuinely different mechanism from the nav-item same-path/query
no-op above — one is a data cache, the other is the router's navigate
short-circuit — but both can present, from the outside, as one
connected-looking "stuff doesn't refresh" symptom. Diagnose them
separately; fixing one doesn't fix the other.

## Known issues (template placeholder)

Use this section, in a real project's copy of this file, for open or
resolved-but-worth-remembering findings specific to that project's own
pages/router usage — following the same "resolved items kept, struck
through, for context" convention as the rest of this knowledge base.
