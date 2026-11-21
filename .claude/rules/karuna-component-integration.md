# karuna Component Integration

Gotchas found integrating specific karuna components — most only surfaced
by live-testing or by reading the component's actual source, not by code
review or a clean build. None of these are bugs in an app's own logic in
isolation; they're behaviors of the shared components themselves, so any
AIUX app reusing the same components can hit them too. Facts tied to a
specific mechanism are tagged with the karuna version they were verified
against — re-check under a different version before trusting them as-is.

This file ships with no `paths:` frontmatter (always loads) since it
spans many unrelated components. Once you know which of your project's
widget directories actually use which of these components, consider
splitting this apart and scoping each piece with its own `paths:` list —
see `rules/README.md` and this template's top-level `README.md`.

## Field pickers

### `aiux-control-field-list-connected` self-resolves its own labels — don't cache them yourself

Given just `.value` (comma-separated field paths, e.g.
`'priority,assigned_to.email'`) and `.dependentValue` (the table), this
component resolves its own display labels via its own GraphQL call
whenever the `.displayValuesWithPath` you passed in doesn't already
cover the value. **You do not need to fetch or persist column labels
yourself** to repopulate this control from a saved value — set `.value`
+ `.dependentValue` and it self-heals the labels in real time, which is
also why they should never be denormalized into storage (a renamed
field's label would go stale).

### Single-select vs. multi-select field pickers — use the right control, don't abuse the multi-select one

`aiux-control-field-list-connected` is genuinely **multi**-select — it
has no single-select mode (no `multiSelection`/`maxValues` prop; check
its actual source before assuming otherwise). If you need a
single-value field picker (e.g. a "which date field" or "which group-by
field" setting), reaching for this control anyway and just keeping the
first value client-side (`values[0]`) works mechanically, but produces a
genuinely confusing UX: the picker's own modal visibly lets the user
check multiple boxes with no indication only one will be kept, and
clicking OK silently drops the rest. The modal (a fully independent
multi-select widget) accumulates every checked item entirely inside
itself and only emits its change event once, on commit, with *all*
selected items — the host never sees anything until then, so there's no
way to constrain the modal to one pick from outside it.

**Use the real single-select control instead**:
`aiux-control-fieldname-connected` — a dropdown + breadcrumb UI, one
plain string `value`/`displayValue` (a dot-path for dot-walked
references), no multi-select modal at all. Reserve
`aiux-control-field-list-connected` for settings that are genuinely
allowed to hold more than one field.

**`allowDotWalking` also controls whether reference fields appear in the
list at all, not just whether dot-walking is offered** *(verified
against `@servicenow/karuna` 22.50.0)*. The transform that builds this
control's field list unconditionally **drops every reference-type
field** from the offered list whenever `dictionaryAttributes.
allowDotWalking` is falsy — this runs on the *initial* table's own field
list, not just a dot-walked sub-table's. That's harmless for a setting
that can never sensibly be a reference field (e.g. a date-bucketing
field — a reference field's raw value is a sys_id, never a date). It is
**not** harmless for a setting like "group by this field," where
grouping by a reference field (assignment group, assigned-to, caller,
etc.) is one of the most common use cases there is. If a reference field
you expect to see is missing from this picker, check whether
`allowDotWalking` is set before assuming the field itself is somehow
excluded some other way.

A row click and its chevron are two separate actions on this component's
drill-down panel: a row click always selects that field's own flat name
regardless of type; the chevron is a distinct control that navigates
into the reference's target table. Only picking a field at that deeper
level produces a dot-joined final value (e.g. `"assignment_group.manager"`).
There is no built-in way to show reference fields as selectable while
suppressing the drill-down chevron — `allowDotWalking` is an all-or-
nothing switch for whether reference fields appear at all.

## `<aiux-condition-builder>`

### Needs `.encodedQuery` bound too, not just `.tableName`

Binding only `.tableName` (plus a listener for its query-changed event)
leaves the component's own `encodedQuery` property at its default empty
string — its own `firstUpdated()`/decode step always decodes that empty
string into zero rows regardless of what your widget's state actually
holds. **Bind `.encodedQuery=${this._encodedQuery}` alongside
`.tableName`** whenever you're populating the builder from an existing
saved query (e.g. loading a record to edit) — the component's own
change-detection for a late-arriving update is real and does work; the
property just has to actually be set in the first place.

### The "Group By" tab can silently corrupt a query your own code also parses with `GlideAggregate`

`<aiux-condition-builder>` accepts a `filterOptions` prop
(`{showGroupBy: false}` disables the Group By tab entirely — a real,
documented flag, not a workaround). This matters beyond cosmetics: the
Group By tab appends a literal `GROUPBY<field>` term to the same encoded
query string that becomes your report/query's `source.query`. Whether
that's harmless or dangerous depends entirely on what consumes the
query downstream:

- A path that just filters/lists rows typically ignores an unrecognized
  `GROUPBY` term harmlessly.
- A path that builds its own `GlideAggregate` from that same query string
  does **not** ignore it — `GlideAggregate.addEncodedQuery()` genuinely
  interprets `GROUPBY`, which can silently return only the *first
  group's* aggregate instead of the true total, or compound with your
  own explicit `.groupBy()` call to group by a field combination the user
  never configured through your own UI at all.

If your app already has its own purpose-built group-by concept
elsewhere (e.g. a dedicated "group by" builder field, separate from the
condition/filter builder), disabling this tab via `filterOptions`
removes a source of pure downside with no loss of capability the app
actually needs. Pass a **module-level constant** object for
`filterOptions`, not a fresh literal per render — it's a plain Object-type
Lit property, so a fresh object every render looks "changed" every time
even when its contents didn't.

## `<aiux-list-connected>` / `ListDataManager.fetch` — verify GQL schema support before relying on it

This family of components' GQL query text can unconditionally include a
field/type that only exists when a specific platform plugin is
installed/activated — an `@include` directive on that field only skips
*execution* when its condition is false, not GraphQL schema
*validation*, which runs first. If that plugin isn't active on the
target instance, the whole query fails schema validation regardless of
what you pass to any "include" option meant to skip that field.

**Before relying on `<aiux-list-connected>`, `<aiux-list-page>`,
`<aiux-gallery-list>`, or `ListDataManager.fetch` anywhere in a project,
confirm via GraphQL introspection that the instance actually has the
type(s) the component's query references**, from a browser console
already logged into the instance (session cookies already present):

```js
fetch('/api/now/graphql', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    query: `{ __type(name: "<TypeName>") { name fields { name } } }`
  })
}).then(r => r.json()).then(console.log);
```

A `null` result means the type doesn't exist on this instance and the
component's own fetch path will fail regardless of prop tweaking or
bumping the karuna version — this is often an instance-side plugin gap,
not a version bug, and can persist across platform-release upgrades.
There is often no client-side workaround, since every path through the
package hits the same query text. If you need list-style data and this
gap exists, resolve it via plain REST calls against the underlying
platform tables directly instead (no GraphQL involved) — that path is
typically unaffected.

## `aiux-dashboard-layout` (or similarly-shaped high-level canvas components)

A generic drag/resize grid canvas component is often genuinely reusable
for a custom "build your own dashboard" feature, but its own README may
be stale relative to its real source (e.g. claiming "read-only, no edit
mode" when the actual source has a full edit mode, save flow, and widget
selector) — read the source, not the README, before deciding it doesn't
fit.

**Its built-in "add item" and "save" flows commonly assume a different
feature shape than "any user builds their own canvas from their own
content":**
- A built-in "add item" flow is often wired to an **admin-curated
  catalog** (a static, category-scoped list), not a live search over
  your app's own content.
- A built-in "save" header button is often wired to a **platform
  personalization API keyed by an `experienceId`** your app may not
  have — check whether it silently no-ops (no error, no toast, nothing
  persisted) when that id is absent, rather than assuming a save button
  that appears to work is actually persisting anything.

If those don't fit, the component can still be reused for just its
drag/resize canvas mechanics:
- Hide the component's own header (title/edit/save/cancel/add) via CSS —
  this is safe specifically when the component renders into **Light
  DOM** (`createRenderRoot() { return this; }`), meaning its content is
  a normal descendant of whatever shadow root it's placed in, not behind
  its own encapsulation boundary, so an ordinary CSS rule from the host
  reaches it.
- Pin "edit mode" true for the widget's whole lifetime if this widget IS
  the editor.
- Add items via a standalone instance of the component's own
  independently-reusable item-selector custom element (if one exists,
  registered as a side effect of importing the main component), fed your
  own app's content and driven by your own "Add" button — not the
  built-in catalog picker.
- Read positions back via the component's own public `getLayout()`-style
  method and persist through your own server actions, never through the
  header's own save button.

**A read-only viewer generally should NOT reuse the same edit-capable
component.** It carries edit-mode machinery (its own item-picker,
personalization state, dialogs) with often-unverified non-edit-mode
rendering behavior, and a read-only view is typically the
highest-traffic, must-just-work surface. A plain CSS grid rendering the
same saved layout data, with zero coupling to the edit component's
internals, is usually the safer choice for that surface even if it means
duplicating the grid-unit math (columns/row-height/gap) so the two
surfaces render identically.

### Five integration bugs found only by live-testing this class of component

None of these showed up in code review or a clean build — each needed an
actual click in the running app to surface.

1. **`document.createElement('some-custom-element')` can throw
   `NotSupportedError: "The result must not have attributes"`.** If the
   component's own constructor sets a property that reflects to a real
   DOM attribute (e.g. `this.popover = 'manual'`) *during construction*,
   the Custom Elements spec forbids that when the element is created via
   `createElement()`/`createElementNS()`, and browsers enforce it with
   exactly this error. That check does **not** apply to elements created
   via HTML parsing (`innerHTML`, `<template>`) — upgrade-on-parse is a
   different algorithm path. **Fix**: build it via a throwaway `<div>` +
   `innerHTML` and take `.firstElementChild`, instead of calling
   `document.createElement()` on it directly. Any custom element whose
   constructor sets a reflected property has this same landmine.
2. **A Light-DOM component's auto-injected-into-`document.head`
   stylesheet never reaches content nested inside a Shadow DOM boundary.**
   If a component injects its own stylesheet into `document.head` once
   (rather than via `static styles`), that only reaches content with
   **no Shadow DOM boundary** between it and the document root — normal
   for the component's own top-level usage, but not for an instance you
   create and mount imperatively from inside a Shadow-DOM widget. Symptom:
   the element renders fully unstyled/unpositioned, potentially
   overlapping unrelated page chrome. **Fix**: portal it —
   `document.body.appendChild()` it directly, outside any shadow root,
   driven imperatively (property assignment, not a Lit template binding).
   A portal'd element's event listeners need **pre-bound** handler refs
   (`this._x = this._x.bind(this)` in the constructor) — Lit's
   `@event=${this._x}` binds `this` for you; a plain `addEventListener`
   call does not.
3. **A component that gates its own initialization on a non-empty items
   array can silently never initialize if your app legitimately starts
   with zero items.** If the underlying renderer only mounts (and
   registers itself into whatever global registry drives
   add/move/resize calls) when its bound item list has length > 0, a
   genuinely empty canvas means that renderer never mounts, and every
   subsequent "add"/"move" call silently no-ops against a registry entry
   that doesn't exist. **Fix**: seed the bound list with one permanent,
   invisible bootstrap item that satisfies the length check but is
   filtered out of actual rendering (and of any "already placed"/export
   logic) by whatever internal helper the component itself uses to tell
   real items apart from catalog/library placeholders.
4. **An async-registering sub-component can race a parent's "enable
   edit mode" call, with no retry or replay.** If the component that
   actually implements move/resize registers itself into a global
   registry inside its own `connectedCallback`, and that
   `connectedCallback` is itself `async` (e.g. awaiting a localization
   step before registering), a parent's very first flip to edit-mode —
   fired near mount time — can race ahead of that registration. The
   registry's own enable-move/enable-resize call typically just logs an
   error and drops the call with **no retry, no replay when the
   instance registers later**. A later, user-driven action (e.g. "add
   item") can work fine anyway because it fires well after mount, which
   makes this intermittent and easy to miss. **Fix**: poll the real,
   public registry API (e.g. `registeredIds().length > 0`) via
   `requestAnimationFrame` until something has registered (with a
   reasonable attempt cap), then toggle the edit-mode property off and
   back on to force the parent to re-run its own enable logic once it's
   actually safe. Setting a Lit reactive property imperatively still
   triggers its own `updated()` cycle, so this needs no access to any
   private internals.
5. **A non-keyed `.map()` render inside a vendored component reorders
   DOM nodes — and their already-bound props — on reorder, if every item
   shares one tag name.** Some grid/list renderers deliberately use plain
   `array.map(...)` instead of a keyed helper (sometimes with an explicit
   comment citing keyed-diffing caching issues in Light DOM as the
   reason). If every item in your canvas shares the exact same widget
   tag name, a reorder (e.g. a drag) can make Lit's **positional**
   (non-keyed) diffing reuse an existing DOM node — and its already-set
   props — for whatever item now sits at that array index, applying the
   wrong item's data to an already-mounted node. **Fix**: give each item
   its own uniquely-registered tag name (a dynamically subclassed and
   registered wrapper element per item id), so the renderer is forced to
   tear down/recreate instead of reusing across a mismatch. **The
   dynamic tag can't safely be the real data-fetching widget itself** —
   a widget's own server-call resolution commonly keys off a
   build/deploy-time-stamped static identity property, falling back to
   the (unrecognized, synthetic) tag name in a dev environment where
   that stamping hasn't happened — which breaks the widget's own data
   fetching exactly where you'd test this. Instead, wrap the real widget
   in a **plain, non-widget wrapper element** that never calls any
   server itself and just renders the always-correctly-tagged real
   widget as an ordinary child; give that wrapper its own file (a second
   widget-base-class-extending class can't live in the same entry file
   as your main widget — see `widget-and-page-conventions.md`).

**A still-open, deeper lesson from this same class of bug**: the
"obvious" fix (switch to keyed rendering) can target the wrong renderer
entirely if the vendored component conditionally swaps its actual
rendering implementation based on a flag (e.g. a GridStack-backed
renderer vs. a plain-`.map()` fallback, selected by an
`enableGridStack`-style prop that might default `true` regardless of
what you'd expect). If a symptom that looks like the non-keyed-`.map()`
bug persists after applying the fix above, **verify which class is
actually instantiated at runtime** before trusting a source-level
diagnosis — read through the actual reconciliation logic the
runtime-confirmed class uses (e.g. an id-keyed sync controller, a
`engine.swap()`-style call) rather than assuming the first plausible-
looking source file is the one actually executing.

### A component's own "unsaved changes" dirty-tracking can outlive a successful save your app performed some other way

If a high-level component tracks its own "has unsaved changes" state via
an internal snapshot-vs-live comparison, and your app bypasses that
component's own built-in save flow (see above) to persist through your
own server actions instead, the component's internal snapshot is never
refreshed by your save — so its dirty-tracking can report "unsaved" even
immediately after a real, successful save round-trip, triggering an
unwanted "leave without saving?" prompt on next navigation.

**Fix pattern**: after your own successful save, reassign the bound
config/data prop to a **new object reference** built from the
just-saved state (not just mutating the existing object in place). Many
such components treat a changed prop *reference* as "externally-provided
new data" and re-run their own initialization path, which typically
includes re-capturing their internal "saved" snapshot from the current
(now genuinely just-saved) state. This uses only the component's
documented public prop contract — reaching into a private field (e.g. a
private `_personalization`-style sub-object) to call its own internal
snapshot-refresh method directly works too, but treats a private field
of a third-party component as public API; prefer the reference-reassignment
approach when it's available.

## `<aiux-tab-group>`

### A bare (non-arrow, non-bound) event-listener reference inside `.tabs[].content` binds `this` to the tab group, not to the component that authored the content

Confirmed live, root-caused by reading the component's own source
(`components/external/tabs/src/tab-group.ts`), not guessed *(verified
against `@servicenow/karuna` 22.62.1 — re-check under a different
version)*. `.tabs[].content` genuinely accepts a real Lit `TemplateResult`
(see the general nested-`TemplateResult`-as-a-property-value pattern this
enables — a widget can build its own interactive markup, including
dialogs/forms, and hand it to the tab group as a tab's content). But
`<aiux-tab-group>` is a completely ordinary `LitElement`: its own
`render()`/update cycle is what ultimately **commits** that nested
`TemplateResult` into real DOM (`_renderTabPanels()` embeds
`tab.content` directly as an interpolated value inside its own `html`
template — the standard, correct way to compose templates in lit-html).

The problem is `this`-binding for `@event=${fn}` listeners nested that
deep. lit-html's automatic `this`-binding for a **bare** listener
reference (`@change=${this._handler}`, no arrow wrapper, no `.bind()`)
resolves to `options.host` of the render call that **actually commits the
DOM node** — and since the nested content is committed via
`<aiux-tab-group>`'s own `render()`/update cycle (its own `LitElement`
internals call `render(this.render(), this.renderRoot, {host: this})`
where `this` = the tab-group instance), a bare reference resolves `this`
to **the `<aiux-tab-group>` element**, not the component whose `render()`
method syntactically authored the `TemplateResult`. This is silent and
has no error: the assignment (`this._selectedFile = file`, etc.) still
"succeeds" — it just lands on an unrelated, non-reactive, ad-hoc property
of the tab-group element instead of the authoring component's own state.
Symptom: a form control inside tab content (a file input, in the
confirmed case) appears to work — no console error, the native browser
interaction completes normally — but the authoring component's own
reactive state never updates, so anything bound to that state (e.g. a
submit button's `?disabled=${...}`) never reflects the change. Every
*other* correctly-arrow-wrapped or pre-bound handler in the same template
keeps working fine, which makes this easy to miss — only the one bare
reference is affected.

**Fix, and the general rule this reinforces**: never use a bare method
reference for an `@event=${...}` listener inside content destined for
`.tabs[].content` (or, by the same mechanism, any other karuna component
property that accepts a nested `TemplateResult` to be rendered via that
component's *own* update cycle) — always either wrap it in an arrow
function (`@change=${e => this._handler(e)}`, correct but creates a new
function every render, causing Lit to detach/reattach the native listener
each time) or, better, bind it once in the authoring component's
constructor (`this._handler = this._handler.bind(this);`, then reference
it bare in the template) — the same "bind in the constructor" pattern
already documented above for portal'd elements. A bound function is
permanently immune to whatever `this` Lit's automatic host-resolution
would otherwise apply, regardless of which component ends up committing
the DOM. **Diagnosing this live**: check `_selectedFile`-style state
directly on the authoring component instance (found via a shadow-DOM-
piercing query, e.g. walking `getRootNode().host` up from the actual
form control) after interacting with the control — if it never updates
despite the native interaction completing with no error, suspect this
exact mechanism before assuming the interaction itself is broken.

## `<aiux-date-range-picker>`

Its popup can be a plain `position:absolute` element — not portalled to
`document.body`, not using the native Popover API — so it gets clipped
by **any** ancestor with `overflow != visible`. This is easy to hit
without realizing it: a scrollable container needed for an unrelated
reason (e.g. a table that needs to scroll inside a fixed-height cell) or
even a vendored grid library's own unconditional `overflow` CSS on its
item-content wrapper (something you may not be able to opt out of via a
class) can silently clip this picker's popup.

**Don't fight it with scoped CSS overrides against the clipping
ancestor's internal selectors** — reaching into a vendored component's
internal CSS to override behavior it never exposed a flag for is fragile
by construction and can break on the next version bump. **The real fix
is structural**: pull the control out from under the clipping ancestor
entirely (e.g. render date/filter controls in their own row outside the
scrollable/overflow-constrained grid, rather than as a grid item
alongside the content that needs to scroll).

Its own trigger label often can't be changed from outside once mounted —
if it reads private reactive state set only by its own internal
apply/clear flow with no public setter, don't try to fork or patch it to
show custom label text; use a small adjacent `aria-live` hint element
instead if you need to communicate something the picker's own label
can't express (e.g. a further-narrowed sub-range on top of a broader
preset).

Its preset list is commonly a flat array of fixed `{id, label, start,
end}` pairs (or a calendar for a custom range) with **no first-class
concept of an ordinal/numbered week** (Week 1, Week 2, ISO week, etc.) —
if you need that, you compute your own N presets and hand them to the
component's presets prop; there's no built-in support to lean on.

## Highcharts inside a karuna-based app

### The module-boundary trap: importing a plain npm Highcharts module can silently register onto the wrong Highcharts instance

karuna commonly ships its own Highcharts-based chart components via a
shared `Highcharts()` mixin (used by whichever built-in visualization
types it already supports), but may have **no support for a specific
series type you need** (e.g. sankey), and no exported way to register a
new Highcharts *series type* onto its shared instance from outside
karuna.

**The core problem**: Highcharts' own ESM modules register a series type
via a **relative import side-effect** (`import * as t from
"../highcharts.js"`), not via a callable factory taking an externally-
supplied Highcharts reference. karuna's own `Highcharts()` mixin
typically gets externalized by the isolate bundler (the same
`@servicenow/aiux-*`-namespace externalization mechanism documented under
`AIUX_REPO_ROOT` in `environment-build-deploy.md`) into a **separately-
built, shared runtime chunk**. A plain third-party npm import like
`"highcharts"` — not `@servicenow/aiux-*`-namespaced — is **not**
externalized the same way; it gets inlined fresh into whichever widget
bundle imports it. So importing a Highcharts module directly from a
widget and passing it into the mixin's `modules: [...]` constructor
argument (a pattern the mixin's own doc comment may show for some
official modules) can silently fail: the module registers its series
type onto *its own*, separately-bundled copy of Highcharts core — never
onto the shared externalized instance the mixin actually renders with.
**Symptom: the chart initializes fine (basic core works), but the custom
series type renders nothing, with no error** — this is genuinely
expensive to debug blind; tracing it via the compiled SVG output showing
an empty shell with zero series content is one way to confirm it's this
class of bug rather than a data problem.

**Fix, for any Highcharts series type karuna doesn't already support**:
don't use karuna's `Highcharts()` mixin for that chart at all. Import
Highcharts core *and* the needed module(s) together, from the same
resolution context (one file), so they're guaranteed to share one
instance:

```js
import HighchartsCore from 'highcharts/esm/highcharts.js';
import 'highcharts/esm/modules/sankey.js';           // or whatever module you need
import HighchartsAccessibility from 'highcharts/esm/modules/accessibility.js';
```

This requires `"highcharts"` as an **explicit direct dependency** in the
project's own `package.json` (pinned to the exact version karuna uses,
so pnpm dedupes to the identical store entry rather than installing a
second copy) — it's not resolvable as a bare import otherwise, since it's
normally only a transitive dependency of karuna. Still extend a
`ThemeAware(Visualization)`-style mixin from karuna's visualization base
package (a plain, standalone-exported mixin, unrelated to the
`Highcharts()` mixin's own core) to keep SSR-safety, the resize observer,
the error boundary, and theme-change rebuilds — just reimplement the
small bit of chart create/update/destroy lifecycle wiring yourself. What's
lost versus the full mixin: an automatic theme-aware chart background
helper typically isn't part of the base package's public exports —
worked around with a plain `backgroundColor: 'transparent'`, simpler and
usually sufficient.

**Adding `highcharts` as a direct dependency requires a real `pnpm
install`, not just editing `package.json`** — and a running dev server
needs a restart afterward; it doesn't pick up a brand-new package that
wasn't in its module graph before, even though it live-rebuilds on
ordinary file edits.

### Highcharts gotchas verified against source (not general Highcharts docs)

- **Node labels route through `dataLabels.nodeFormatter`, not
  `dataLabels.formatter`**, for sankey-style node/link charts. The
  label-drawing code dispatches via `(labelOptions[point.formatPrefix +
  'Formatter'] || labelOptions.formatter)`, and node points get a
  `formatPrefix` of `'node'`. A series' own default options may already
  set `nodeFormatter` — overriding `formatter` alone silently no-ops for
  node labels (they keep using the untouched default), while `formatter`
  only ever affects link labels. This is an easy, silent mistake —
  nothing errors, the label just doesn't show your custom content.
- **`this` in a `formatter`/`nodeFormatter` callback is the Point
  itself**, not `this.point` — that's the *tooltip*-formatter convention,
  a different callback contract. Access custom per-point data via
  `this.options.custom.xxx` (a real special-cased prefix in the point's
  own nested-property getter) — not `this.custom.xxx` directly.
- **`dataLabels.inside` defaults to `true`** (sized to fit within the
  point's own shape) for node-type points. Forcing `inside: false` to fit
  wider content can surface the next point behind it, worse than the
  crowding it was meant to fix — prefer `inside: true` and, if content
  doesn't fit, a wider node size instead.
- **Highcharts' own overlap-avoidance hides labels, it does not
  reposition them.** Any label Highcharts judges collides with another
  label or the plot boundary gets hidden (opacity/visibility, plus a
  marker class) — confirmed via DOM inspection: the element exists, fully
  populated, just invisible. `dataLabels.allowOverlap` defaults to
  `false`. Two large adjacent points with `inside: false` labels is
  exactly the case that trips this — and a hidden label reads as "this
  point has no value," which is often worse than letting an occasional
  pair sit close/overlapping. Set `allowOverlap: true` as a safety net
  regardless of the `inside` choice.
- **`useHTML: true` multi-line dataLabel content gets clipped by
  default** — the label's own container is sized for one line; needs an
  explicit `overflow: visible` + `white-space: nowrap` CSS rule on the
  data-label element/its children, or a second line silently disappears
  with no DOM/console signal.
- **`title.text` defaults to the literal placeholder string `'Chart
  title'`** — not something any app code sets; every unconfigured
  Highcharts chart shows this. Set `title: {text: null}` explicitly.
- **`credits.enabled: false`** removes the default watermark/credit link
  — separate from an always-present, always-`aria-hidden`, purely-inert
  SVG `<desc>` element every Highcharts chart emits as standard
  accessibility boilerplate (invisible to sighted users, inert to
  assistive tech, no supported way to remove it, no reason to bother).
- **A sankey/node-link chart's node column position is derived entirely
  from link-graph topology, not assigned by your own app code.** A
  node's visual column comes from Highcharts' own internal layout
  algorithm reading which nodes have incoming links from which — your
  code doesn't (and typically can't) set it directly, even when your data
  model has an explicit notion of "stage"/"column" per node. **A node
  with zero incoming links gets treated as a source node — column 0 —
  regardless of which conceptual stage it actually belongs to.** If a
  node ever renders in the wrong column, don't assume it's a labeling or
  positioning bug in your own drawing code first: check whether that
  node is actually missing its link chain back to a source. A
  disconnected-looking node is usually a genuine missing-link bug (e.g.
  an upstream aggregation query failing to produce a link for that node
  under some data condition — a blank/empty value is a common trigger,
  see `glide-platform-facts.md`'s `GlideAggregate.groupBy()`/`IN`-vs-
  `ISEMPTY` entries), not a rendering/column-assignment bug — chase the
  data pipeline before the chart config.
- **A sankey/node-link chart has no option to control a node's vertical
  stacking order within its own column** — confirmed by reading the
  series' own source: point generation stable-sorts by layout level, and
  the series' own layout step only computes that level from link
  topology; there's no per-node rank/weight input anywhere in the option
  schema. The actual mechanism is purely **insertion order**: a node's
  vertical position within its column is determined by the order it's
  *first referenced* while Highcharts scans your `data` array (i.e. your
  **links**, since that's what a sankey series' `data` actually is)
  top to bottom. If you need a specific node to render last within its
  column (e.g. to visually de-emphasize a synthetic "empty"/"other"-style
  node), the lever is **reordering your links array before handing it to
  the chart** — a stable partition (move every link that touches the
  target node to the end, leaving every other link's relative order
  untouched) is enough; you don't need a full sort. This has to happen
  client-side, in whatever code actually builds the chart's `data` option
  — reordering the equivalent array on the server has no effect, since
  insertion order only matters for what the chart library itself does
  with the array at render time, and nothing about that ordering survives
  being reconstructed into some other shape (e.g. a plain nodes+links
  object) before it reaches the chart. **Known limitation of this
  technique, accepted rather than engineered around**: partitioning by
  "does this link touch the deferred node" also defers any *other* node
  whose only link happens to touch that same deferred node on its far
  end — that other node's first reference lives inside the deferred
  group too, so its own ordering gets pushed down alongside it even
  though it isn't the node you actually meant to de-emphasize. Edge
  case, not the common case (a real node reachable only via a single
  link from the node you're deferring) — worth knowing about rather than
  being surprised by it, not necessarily worth a more complex fix.

### Custom chart decorations (e.g. per-column headers) need hand-drawn SVG, redrawn on every render event

Highcharts has no native "per-column header" (or similarly bespoke
decoration) concept for most chart types. The pattern: hand-draw SVG
elements via the chart's own renderer (`chart.renderer.text(...).add()`),
redrawn on every `chart.events.render` firing (covers both the initial
draw and every subsequent `.update()` call, since layout positions often
aren't knowable ahead of a render pass). Derive positions from the
chart's own *actual*, real per-point layout properties (e.g.
`shapeArgs.x`/`.width`, a point's own column/group index) rather than
recomputing layout yourself. Clamp text that could overflow the chart
edge using the label's own measured bounding-box width, not a guessed
fixed margin — the right clamp depends on the actual rendered text
length. Reserve room for the decoration via the chart's own margin
options, and explicitly `.destroy()` previous decoration elements before
redrawing each render pass, or they accumulate silently across updates.

## AMB (Asynchronous Message Bus) integration

AIUX has a real, first-class AMB integration — not something you'd build
from scratch on top of raw `amb-client-js`. Confirmed by reading the
actual source, not inferred from the filename *(verified against
`@servicenow/karuna` 22.50.0 — re-check under a different version)*.

**Public exports**, from `@servicenow/aiux-components-core` (bare
import, same package as `AIUXElement`/`decorators`/etc.):
`getAMBService`, `setAMBService`, `buildRecordWatcherChannel`,
`AMBController`, `MockAMBService`.

`getAMBService()` returns a client-side singleton (SSR-safe — every
method no-ops on the server) wrapping `amb-client-js`:

- `subscribe(channel, callback)` → join/listen to a named channel,
  returns `{unsubscribe}`.
- `subscribeToRecordWatcher(table, query, callback, actionPrefix?)` →
  subscribes to a record-watcher channel without hand-building the
  channel name. The name format (also exposed standalone via
  `buildRecordWatcherChannel()`) is
  `` /rw/{actionPrefix}/{table}/{base64(query)} `` — the query is
  base64-encoded internally, matching `amb-client-js`'s own encoding.
- `publish(channel, message, callback?)` / `publishAsync(...)` (the
  latter falls back to a REST call if the message exceeds CometD's
  message-size limit).
- `batch(fn)` — coalesce multiple subscribe/publish calls into one
  CometD network round-trip.
- `connect()` / `disconnect()` / `getConnectionState()` /
  `subscribeToEvent(event, callback)` (connection-lifecycle events, e.g.
  `cometd.connected`) / `isLoggedIn()`.

**`AMBController`** is the pattern to actually use inside a widget/page —
a Lit `ReactiveController` that subscribes on `hostConnected()` and
unsubscribes on `hostDisconnected()` for you:

```js
class MyWidget extends AIUXElement {
  _amb = new AMBController(this);
  connectedCallback() {
    super.connectedCallback();
    this._amb.setChannels(this.loaderData?.ambChannels ?? [], (msg) => this._onMessage(msg));
  }
}
```
`setChannels(channels, callback)` / `setRecordWatchers(watchers,
callback)` bulk-wire subscriptions (replacing any existing ones) — handy
when the channel list comes from `loaderData`.

**Caveats found in the source:**

- "Creating"/"joining" a channel here means subscribing to or publishing
  on a channel *path* the platform already recognizes (record watchers,
  or an app-specific channel some server-side script publishes to) — not
  provisioning a new server-side AMB channel from client code. There is
  no client-side "create channel" concept.
- `amb-client-js` itself loads lazily via an async `import()`. On a cold
  page, `getAMBService().getClient()` can legitimately return `null`
  before that resolves. The source's own comment flags `await
  ambClient.connected` as unreliable on a cold start for exactly this
  reason, and recommends preferring `AMBController` or
  `getAMBService().subscribe()` — both queue subscriptions internally
  (`_pendingChannels`) and flush them once the client actually loads,
  rather than racing it.
- A legacy-compatible adapter is also registered as a named service
  (`getService('amb')`, reachable as `this.deps.services.amb` on a
  widget that predates `AMBController`) — same modern `AMBService`
  underneath, exposed through an older API surface for widgets migrating
  off `UxKitElement`.
- `MockAMBService` (with a `receiveMessage(channel, message)` method to
  simulate incoming messages) exists specifically for unit tests — pass
  it in via `new AMBController(host, {service: mock})` rather than
  hitting a real WebSocket in test code.

## Known issues (template placeholder)

Use this section, in a real project's copy of this file, for open or
resolved-but-worth-remembering findings specific to that project's own
karuna component usage — following the same "resolved items kept, struck
through, for context" convention as the rest of this knowledge base.
