# Widget & Page Conventions

These apply to any `AIUXElement`/`AIUXWidgetElement` subclass regardless
of which specific karuna components it happens to use — see
`karuna-component-integration.md` for component-specific gotchas.

## Reusable UI before writing custom components

Before building custom UI, check what karuna already ships:

```bash
node -e "console.log(Object.keys(require('./node_modules/@servicenow/karuna/package.json').exports).join('\n'))"
```

The package-name imports this surfaces (`@servicenow/aiux-components-*`)
are re-exports — `node_modules/@servicenow/aiux-components-*` doesn't
exist as its own package. They resolve through `@servicenow/karuna`'s
`exports` map to real source under
`node_modules/@servicenow/karuna/components/`. Read the source there
directly instead of guessing a component's props/events/behavior —
`grep -rn "methodName" node_modules/@servicenow/karuna/components/` is
the fastest way in.

Some known-useful exports and where they actually live *(paths verified
against `@servicenow/karuna` 22.50.0 — re-check under a different
version)*:

| Package export | Real path under `karuna/` |
| --- | --- |
| `aiux-components-control` | `components/external/controls/src/` (e.g. `field-list-connected/`, `fieldname-connected/`, `typeahead/`, `input/`, `checkbox/`, `radio-group/`) |
| `aiux-components-condition-builder` | `components/condition-builder/src/` |
| `aiux-components-icon` | `components/icon/` |
| `aiux-components-nav` | `components/nav/` |
| `aiux-components-core` | `components/core/` (base classes, decorators) |
| `aiux-components-dashboard-layout` | `components/dashboard-layout/src/` |
| `aiux-components-date-range-picker` | `components/date-range-picker/src/` |
| `aiux-components-visualizations-highcharts` | the `Highcharts()` mixin — see `karuna-component-integration.md` |

To resolve any other `@servicenow/aiux-*` import this way:

```bash
node -e "console.log(JSON.stringify(require('./node_modules/@servicenow/karuna/package.json').exports['./<subpath>'], null, 2))"
```

Before using any icon name, verify it exists in karuna's generated
catalog — `node_modules/@servicenow/karuna/directives/icon/types/__generated__/icon-names.d.ts`
— rather than guessing. Not every base name has every suffix variant
(e.g. some icons have no `-outline` variant even when a sibling icon
does) — check the actual generated list, don't assume a naming pattern
holds for every icon.

## Every explicit-fetch widget must set `static fetchDataOnConnect = false`

`AIUXWidgetElement` defaults `static fetchDataOnConnect = true`. On
`connectedCallback()`, whenever that flag is true and `this.data` is
still `undefined`, it automatically fires `this.server.update()` — which
calls the widget's server script with **`input: host.data`, i.e.
`undefined`** (JSON-serialized, so the `input` key is dropped from the
POST body entirely).

This is the supported pattern for widgets built around the reactive
`this.data` property (e.g. via a `WithData`-style mixin) — but a widget
that fetches explicitly instead (its own `this.server.get({action, ...})`
calls, with its own loading/error state) never reads `this.data` at all.
For those widgets this automatic call is not just wasted — it actively
misfires against the server script's own action dispatcher with an empty
payload:

- If the server script requires an explicit `input.action` with no
  default, the empty call resolves `action` to `undefined` → an
  `"Unknown action: undefined"`-style error.
- If the server script defaults the action to some default handler
  instead, that handler can still fail its own required-input guard on
  the empty payload.

Both failure modes can surface as a real, visible error notification on
mount, even though the widget's actual (later, explicit) fetch succeeds
right after — confusing because it looks like an intermittent bug rather
than a guaranteed extra call on every connect.

**Fix**: add `static fetchDataOnConnect = false;` to every widget that
manages its own fetch/state and never reads `this.data`. This is a real,
typed, public override point on the base class (not a workaround) — it
exists specifically for widgets that don't use the reactive `this.data`
auto-fetch path. Easy to forget since nothing fails at build time; the
symptom only appears at runtime as a spurious error notification on
connect.

## A widget entry file may declare only one top-level widget-base-class class

Some Now SDK build versions enforce this and fail the whole build if
violated: a widget entry file must declare exactly ONE top-level widget
class — its `@customElement` identity. "Widget base class" here means
any class extending `AIUXElement` or `AIUXWidgetElement` — not just
`AIUXWidgetElement`. A second class in the same file, even a lightweight
client-side rendering helper with no server calls at all and never
itself deployed as its own widget record, still trips this.

Fix: any second (or third, etc.) widget-base-class class needs its own
sibling file, imported into the entry file purely for its
`customElements.define()`/`@customElement` registration side effect —
e.g. a `report-tile-slot.js` imported into `index.js` as `import
{tileSlotTag} from './report-tile-slot.js';`.

## A widget that loads by a host-provided sys_id needs a `_maybeLoad.../_lastLoadedSysId` guard

A widget that fetches based on a host-provided id-like property commonly
ends up shaped like:

```js
connectedCallback() {
  super.connectedCallback();
  void this._loadRecord();
}
updated(changed) {
  if (changed.has('recordSysId')) {
    void this._loadRecord();
  }
}
```

Lit sets a template-bound property before/around the same synchronous
pass that triggers `connectedCallback()`, so on a completely normal
mount the property is already non-null by the time
`connectedCallback()` runs — and the very first `updated()` cycle then
sees it as "changed" too, since it moved from the constructor's `null`
default. Both call sites fire. **This fetches the same record twice on
every single mount** — no error, just doubled, unnecessary load (and,
worse, no guarantee the two in-flight responses settle in request order).

Fix, applied at both call sites: a `_maybeLoadRecord()` wrapper guarded
by a `_lastLoadedSysId` check (`if (id && id === this._lastLoadedSysId)
return;`), called from *both* `connectedCallback()` and `updated()` — the
second call becomes a no-op once the first has already set
`_lastLoadedSysId`. Additionally add a staleness guard **inside** the
load function itself: capture the id in a local at the top, before the
`await`, and check `this.<prop> !== capturedId` after it resolves, in the
success path *and* the catch/finally. The call-site guard alone stops
the redundant double-fire on mount; the in-function guard additionally
protects against a slower, genuinely-stale response overwriting a newer
one if the id changes again while a fetch is still in flight.

Any new widget that loads data keyed off a property the host sets (a
route param, an id-style prop) needs both halves of this pattern — the
double-fetch-on-mount risk exists purely from `connectedCallback()` +
`updated()` both being wired to call the loader, not from anything
specific to any particular feature.

## A widget that self-fetches on mount can render twice — trigger the fetch from `firstUpdated()`, not `connectedCallback()`

A widget commonly fetches its own data unconditionally on mount:

```js
connectedCallback() {
  super.connectedCallback();
  this._fetchData();
}
```

This is fine for a purely client-rendered widget, but for an
`AIUXWidgetElement`/`AIUXElement` that's server-side rendered and then
hydrated on the client, this is a real, confirmed failure mode — not a
theoretical one. **The widget can end up rendering its own content
twice, stacked inside its own shadow root**: the original SSR'd markup
(wrapped in Lit's own `<!--lit-part-->...<!--/lit-part-->` hydration
boundary comments) followed immediately by a second, un-hydrated copy of
the exact same content (preceded by a bare `<!---->` or a raw,
un-committed `<!--?lit$...$-->` template marker instead of a real
`lit-part` pair, depending on the build). Confirmed directly via the
browser DevTools Elements panel on a real deployed instance — not merely
inferred from source.

**Root cause**: `connectedCallback()` runs during SSR too — it is not a
client-only lifecycle hook (see the SSR-safety guidance elsewhere in this
knowledge base). If the widget also fires an async fetch there, that
fetch resolving client-side and updating reactive state (`this._loading =
false`, etc.) can trigger Lit to perform its own update/render pass on
the element *before or during* the point where client-side hydration is
supposed to attach to and reuse that element's already-SSR'd shadow-root
content. When that race is lost, the original SSR'd content is never
properly hydrated/reused — it just sits there — and a second, separately
rendered copy gets appended right after it.

A widget with no such self-triggered update on mount (e.g. one whose data
only loads once a host-provided prop is set, well after hydration has
settled) does not exhibit this. The differentiator isn't the widget's own
template shape — it's *whether the widget updates itself, unprompted by
the host, shortly after mount*.

**Fix**: trigger the initial fetch from `firstUpdated()` instead of
`connectedCallback()`:

```js
firstUpdated() {
  // Deliberately not connectedCallback() - that also runs during SSR, and
  // an async fetch resolving there can race ahead of client hydration for
  // this element, causing a duplicated, un-hydrated render.
  this._fetchData();
}
```

`firstUpdated()` only ever runs client-side, after the first real
render/update cycle — never during SSR — so the fetch (and the state
update it causes) can't fire until hydration has already completed for
that element.

*(Verified against `@servicenow/karuna` 22.50.0 /
`@lit-labs/ssr@3.3.1` / `@lit-labs/ssr-client@1.1.8` — re-check under
different versions. A source-level investigation traced the mechanism
partway into `@lit-labs/ssr`'s `defer-hydration` attribute handling and
`ssr-client`'s hydrate-vs-plain-render branch in
`lit-element-hydrate-support.js`, but could not fully close the loop on
the exact race from static reading alone — this fix was confirmed
empirically, by live DevTools inspection before and after the change,
not purely by reasoning about the source.)*

Also worth knowing, since it looks related but isn't the fix on its own:
giving a nested widget at least one real bound property (so `lit-html`
tracks a part for its host tag) is a *separate*, real mechanism
(`@lit-labs/ssr`'s `render-value.js` adds a `defer-hydration` attribute
specifically to nested custom elements) — but it is **not** sufficient by
itself to prevent this bug. Only moving the self-triggered fetch to
`firstUpdated()` actually resolved it in the confirmed case; adding a
bound property alone did not.

## `<aiux-control-input>` erases typed text on selection unless you also listen to `STAGED_VALUE_CHANGED`

Typing into a plain `<aiux-control-input>` field, then selecting some of
what was just typed (by mouse **or** keyboard, e.g. Shift+ArrowRight),
can erase the text. Root-caused by reading the actual component source
(`components/external/controls/src/input/`), not guessed *(verified
against `@servicenow/karuna` 22.50.0 — re-check under a different
version)*:

- The component only dispatches `AIUX_CONTROL_INPUT#VALUE_CHANGED`
  **on blur**. While actively typing, it only dispatches a **debounced
  (250ms) `AIUX_CONTROL_INPUT#STAGED_VALUE_CHANGED`** (`detail:
  {fieldValue, ...}` — note `fieldValue`, not `value`). A widget that
  only listens to `VALUE_CHANGED` never updates its own bound state while
  the user is typing — that state stays stale until blur.
- Selecting any text inside the field fires the native `select` event,
  which a shared mixin unconditionally handles by setting a reactive
  private state field, forcing a re-render — regardless of whether any
  feature that mixin exists for is even configured on the control.
- That re-render's `<input>` binds its value through Lit's `live()`
  directive against the component's own `value` prop (i.e. whatever the
  host last bound down — stale, per the first bullet). `live()` compares
  the *actual live DOM value* against that target and forcibly overwrites
  the DOM back to the stale value whenever they differ — which they now
  do, because of the second bullet.

**Fix, for every `<aiux-control-input>` usage**: bind the *same* handler
to both `@AIUX_CONTROL_INPUT#VALUE_CHANGED` and
`@AIUX_CONTROL_INPUT#STAGED_VALUE_CHANGED`, reading `e.detail?.value ??
e.detail?.fieldValue` — this keeps the widget's own bound state within
~250ms of whatever's actually in the DOM at all times, so a
selection-triggered re-render's `live()` binding has nothing stale to
stomp. This closes the gap in all but the tightest timing case (selecting
text within the same debounce window as the keystroke that produced it)
— not a hard guarantee, since the debounce is internal to the component
and can't be shortened from outside without patching a vendored
component (see "Do not patch karuna's `await import()` shims" — the same
"don't patch a vendored component" reasoning applies to any of its
internals, not just that specific shim).

**Any `<aiux-control-input>` usage needs both listeners, not just
`VALUE_CHANGED`** — this is a property of the control itself, not
something specific to any one field it happened to be found on first.

## Light/dark theme via karuna's `NavLayout`

karuna can generate real light/dark theme support from a theme config
file (commonly `primary_color`/`neutral_colors`/`shape`-style settings)
— a theme package derives both a `[data-theme="light"]` and a
`[data-theme="dark"]` CSS custom-property set from it, and `NavLayout`
itself defines semantic tokens (`var(--color-base-200)`,
`var(--color-neutral)`, `var(--color-base-content)`, etc.) that flip
automatically with `data-theme`. Which set applies is switched via a
`data-theme` attribute karuna sets on `<html>`, sourced from the **AIUX
app's own** light/dark preference (a `glide.aiux.theme_mode`-style user
preference key) — **not** the classic ServiceNow platform-wide dark
theme setting. There is typically no "auto/system" option in this shape,
only an explicit `'light'`/`'dark'` choice.

If a page's layout ever hardcodes fixed hex values for the nav-shell
custom properties (`--nav-sidebar-bg`, `--nav-header-bg`, etc.) in a
`static styles` override block, that pins the shell to one fixed palette
regardless of the app's own light/dark preference — removing the
override (rather than deleting it outright, in case the fixed palette
needs restoring later) lets the shell inherit karuna's own generated
tokens and correctly track light/dark.

## Disabling nav features (e.g. chat) via the `features` object

`NavLayout` reads a `features` object (from the layout's `loader()`) with
its own defaults — e.g. `chat: true`. Setting `features: {chat: false,
...}` in that object turns off the underlying controller/panel
infrastructure for that feature app-wide, not just a sidebar nav item —
confirm the actual mechanism by reading the nav component's source
directly (it typically swaps in a no-op controller implementation when a
feature flag is false) rather than assuming a flag only hides a menu
item. Since a Simple-architecture app typically has one shared layout
file for every page, one flag change there takes effect everywhere.

## Runtime prop vs. `@config` field — additive, never interchangeable

Some AIUX widgets need to support both a **host-driven runtime prop**
(the parent page/widget passes data in via a template binding, evaluated
per render, code-driven) and an **admin-configured `@config` field** (fed
by a design-time config store, keyed by the host's `elementId`,
read-only from the widget's own code). These are not two ways to express
the same thing — they're structurally different and additive:

| | Runtime prop | `@config` field |
| --- | --- | --- |
| Set by | host page code, per render | an admin, in a config editor |
| Timing | runtime, reactive | design-time, persisted |
| Writable from code | yes | **no — read-only** |
| Source of value | the parent's template binding | the config store, projected by `elementId` |

**Never try to convert a runtime prop into a `@config` field.** A
`@config` field is fed by the config store via the `elementId` directive
on the *host*, not by a `.prop=${...}` binding, and it cannot be
combined with `@property()` — assigning to one does nothing. Converting
a widget's existing runtime-prop-driven behavior to `@config` this way
kills whatever live, code-driven use of it existed **silently**: no
error, the widget just renders at defaults.

If a widget genuinely needs both (e.g. so it can be dropped onto an
admin-configured surface *and* driven live by a page that already has
the data), the pattern is:

1. Keep the existing runtime prop exactly as-is — a `static properties`
   entry, code-driven.
2. Add **separately named** `@config` fields. Never co-decorate one
   property with both.
3. Resolve with explicit precedence in the widget: an explicit runtime
   prop wins; otherwise assemble the equivalent from the `@config` field
   values; otherwise fall back to a hardcoded default.
4. Add the `elementId` binding on host instances that should expose
   config. **Without it the widget still works at `@config` defaults —
   it's just not configurable, and there is no warning.** This is the
   most common oversight when wiring this up.
5. On the server side, `@config` values typically arrive as a **second**
   argument to the server entry point (commonly named `options`,
   alongside the usual `input`) — wire it as the fallback below the
   runtime-driven input, not as a replacement for it.

A `type: 'custom'` config field is usually needed for anything whose
valid choices depend on another field's value (e.g. a column picker that
needs to know which table was chosen) — a built-in multi-select config
field type generally only supports a *static* choices list, not one that
reacts to a sibling field. Check the framework's own config-field-type
and config-field-dependency documentation before assuming a dynamic
`tableName`-style dependency between two config fields is supported
out of the box.

## Known issues (template placeholder)

Use this section, in a real project's copy of this file, for open or
resolved-but-worth-remembering findings specific to that project's own
widgets — following the same "resolved items kept, struck through, for
context" convention as the rest of this knowledge base.
