# Environment, Build & Deploy

## Fluent metadata

Fluent API shapes (`.now.ts` files — tables, roles, ACLs, business rules,
flows) are easy to guess wrong. Check the `@servicenow/sdk` type
definitions in `node_modules` for the actual shape rather than inferring
it from surrounding code — existing code in a repo may itself be a prior
session's guess, not verification.

### Where the actual `Column`/`Table` type defs live

`@servicenow/sdk/core`'s own file (`src/core/index.ts`) is just a barrel
of `export * from '@servicenow/sdk-core/<subpath>'` re-exports — no type
bodies. `@servicenow/sdk-core` is a separate package that pnpm does
**not** hoist to top-level `node_modules/`, so
`node_modules/@servicenow/sdk-core` does not exist and
`require.resolve('@servicenow/sdk-core/db')` fails from the project root.
The real `.d.ts` files live under the pnpm store, versioned:

```
node_modules/.pnpm/@servicenow+sdk-core@<version>/node_modules/@servicenow/sdk-core/dist/
```

Find it without hardcoding the version:

```bash
find node_modules/.pnpm -maxdepth 1 -iname '@servicenow+sdk-core@*'
```

Column factories live one per file under `dist/db/types/` (e.g.
`Json.d.ts`, `String.d.ts`, `Choice.d.ts`, `Reference.d.ts`,
`FieldName.d.ts`) plus the base shape in `dist/db/Column.d.ts`.
`dist/db/index.d.ts` lists every exported column type in one place —
check it before guessing whether a column type exists (e.g. `JsonColumn`
exists and supports nested objects/arrays via a `json()` helper;
`NameValuePairsColumn` also exists but its own doc comment says "no
nested objects" — doesn't fit anything with a nested shape). Note
`dependent` (for scoping a field picker to another column's value) is
defined on the base `Column` type itself, not something only
`FieldListColumn`/`FieldNameColumn` add — check the base type before
assuming a property is specific to one column type.

A `ReferenceColumn`'s stored/returned value is always the target table's
`sys_id` (a branded sys_id type), regardless of the `referenceKey`
property — that property's doc comment describes it as being for
many-to-many relationship setup, not "use this field's value instead of
sys_id." Don't reach for it to avoid a sys_id-vs-value refactor; it
doesn't do that.

### `MultiLineTextColumn` silently defaults `max_length` to 40 if you omit `maxLength`

`MultiLineTextColumn({label: 'Foo'})` with no `maxLength` compiles and
deploys with no error or warning, but the generated `sys_dictionary`
record ends up with `max_length="40"` *(verified against `@servicenow/sdk`
4.11.0 by inspecting the generated `dist/app/dictionary/<table>.xml`
output directly — `grep max_length` — not guessed)* — the same small
default a plain single-line field would get, not something scaled for
the free-form paragraph text this column type exists for. Any value
saved beyond 40 characters is silently truncated, with nothing surfaced
anywhere to say so.

This is easy to miss for a long time: nothing in the build output calls
it out, and a short value during development (under 40 chars) won't
reveal it at all — it only bites once real content crosses that
threshold, which can be well after the field has already shipped. Always
pass an explicit `maxLength` on `MultiLineTextColumn`. Don't assume this
is unique to that one column type either — verify the generated
dictionary XML's `max_length` attribute directly for any column type
where you didn't set one explicitly, rather than trusting the build's
silence.

### `ChoiceColumn` needs `legacyChoices: true` in `now.config.json` on many instances

Every `ChoiceColumn` gets wrapped in a choice-set record by
`sdk-build-plugins`' `choice-set-plugin.ts` *(verified against
`@servicenow/sdk` 4.9.0 — re-check if newer)*:
```ts
const isLegacy = config.legacyChoices === true
const wrapperName = isLegacy ? 'sys_choice_set' : 'sys_choice_v2'
```
Note this is **backwards from the schema's own stated default** —
`now.config.schema.json` describes `legacyChoices` as defaulting to
`true`, but the actual code above only treats it as legacy when the
value is the literal `true` — leaving it **unset** behaves as `false` at
runtime, i.e. `sys_choice_v2`. `sys_choice_v2` is a newer platform table
("v4 additive merge with removed_choices tracking," requires a
sufficiently recent platform release per the schema's own description)
that may not exist on an older instance even after a platform-release
upgrade — build/deploy then fails with `Table 'sys_choice_v2' does not
exist`. Fix: set `"legacyChoices": true` explicitly in `now.config.json`
to force the older, universally-supported `sys_choice_set` wrapper if
you hit this. Don't rely on the schema's documented default — verify the
actual runtime check in `choice-set-plugin.ts` for whatever SDK version
you're on.

A missing `sys_choice_v2` table can also produce a separate-looking
error during update-set deploys: `Failed to upload XML files: Cannot
invoke "com.glide.db.PrimaryKey.addQuery(...)" because "this.fPrimaryKey"
is null`. Before blaming file-upload ordering for this (plausible-looking,
since `installConfigurations()` uploads `dist/app/*.xml` in raw
filesystem order with no dependency sort), check whether the actual cause
is a missing table instead — verified once by comparing file order across
a broken and a fixed build and finding it identical; only the table's
existence differed.

### `ChoiceColumn` defaults to `dropdown: 'none'` — display_value never resolves via the Table API even with correct `sys_choice` rows deployed

`ChoiceColumn`'s own type signature (`@servicenow/sdk-core`'s
`Choice.d.ts`) defaults its `dropdown` option to `'none'` whenever it's
omitted — every `ChoiceColumn({...})` call that doesn't explicitly set
`dropdown` gets this. `'none'` writes the underlying `sys_dictionary`
row's `choice` attribute as `'0'`/blank (`choiceDropdown` = `['none',
'dropdown_with_none', 'suggestion', 'dropdown_without_none']`, mapped to
`'0'`/`'1'`/`'2'`/`'3'` respectively) — confirmed directly in generated
build output (`grep '<choice>' dist/app/update/sys_dictionary_*.xml`).

**Consequence, confirmed live against a real instance**: a field left at
the `dropdown: 'none'` default can have completely correct, correctly-
labeled `sys_choice` rows already deployed (verified via `now-sdk query
sys_choice -q "name=<table>^element=<field>"` — real rows, real labels,
`inactive=false`, correct `language`) and a real `sys_choice_set`
wrapper record (correctly scoped to the app), and **the Table API still
returns the raw choice key as `display_value`, not the label** — e.g.
`{"value": "failed", "display_value": "failed"}` instead of `{"value":
"failed", "display_value": "Finished with Errors"}`. An OOB choice field
on the same instance (e.g. `incident.priority`) resolves correctly side
by side with the same query shape — this is not a general instance/cache
issue, it's specific to fields left on the SDK's `dropdown: 'none'`
default.

**Fix**: set `dropdown` explicitly on every `ChoiceColumn`:
- `dropdown: 'dropdown_with_none'` for an optional field with no
  `default` — allows a genuinely blank value.
- `dropdown: 'dropdown_without_none'` for a `mandatory` field or one with
  a `default` set — never leaves it blank.

Confirmed by build output after the fix: `dropdown_with_none` → `<choice>1</choice>`,
`dropdown_without_none` → `<choice>3</choice>`, both now non-blank. No
redeploy-and-wait/cache-flush needed to diagnose this — the blank
`sys_dictionary.choice` value is visible directly in the generated XML
before you even install, if you know to check it.

**This is a genuinely generic Fluent SDK behavior, not specific to any
one app's schema** — every `ChoiceColumn` in a fresh AIUX/Fluent app
needs this set explicitly, or its choice labels silently never resolve
via the Table API despite everything else being deployed correctly. This
finding is worth upstreaming into the source `aiux_claude` template repo
(this is a local copy that won't sync back on its own — see this
project's own `CLAUDE.md`).

### Dynamic Choice List only mirrors an already-choice-backed field — it does not derive choices from a plain field's distinct values

A `ChoiceColumn` with `dynamicValueDefinitions: {type:
'choices_from_other_table', table: '<other table>', field: '<field>'}`
looks like it should let a native platform form's dropdown read its
options from another table's rows. It doesn't do that. Confirmed against
real platform semantics: Dynamic Choice List **reuses an already
choice-backed field's existing `sys_choice` set** (e.g. mirroring
`incident.state`'s choices onto another field) — it does not derive
choices from a field's distinct raw string values. If the target field
(`field` above) is a plain `StringColumn` with no `sys_choice` set of its
own, there's nothing for the dropdown to inherit and it renders with zero
options, silently.

The actual, fast way to confirm this before spending a debugging session
on it: inspect the dictionary entry's `choice_field` reference picker
directly on the instance — it only ever offers fields that are
themselves already choice/list-backed with real `sys_choice` records,
never an arbitrary string field. If the field you want to key off has no
such set, this mechanism can't help; either give it one (see the
tradeoffs below) or use a plain `StringColumn` and drive the picker UI
entirely from your own widget/server code instead — a native platform
form's dropdown doesn't have to be the source of truth for a field a
custom builder UI already fully owns.

Two replacement designs worth naming and their tradeoffs, if you land
here after a failed Dynamic Choice List attempt:

- **A static `choices: {...}` literal**, Fluent's own build-time
  choice-set generation. Works, but needs hand-maintenance in lockstep
  with whatever seeds the underlying rows, forever — appropriate only if
  the value set is genuinely static.
- **A business rule** that upserts/deletes matching `sys_choice` records
  at runtime whenever the source table changes, keeping a native form's
  dropdown self-updating with no static list to maintain. Creates records
  on the target instance that don't exist in your app's own source/update
  set — untracked application data. Worth it only if a self-updating
  native-form dropdown is actually a requirement; if the field is only
  ever edited through your own widget UI, skip both and use a plain
  `StringColumn`.

### Removing a `choices` literal leaves old `sys_choice` rows orphaned

If a `ChoiceColumn` ever had a static `choices: {...}` literal and it's
later shrunk or removed (e.g. switching to `dynamicValueDefinitions`, or
to a plain `StringColumn`), the previously-generated `sys_choice` rows
are **not** deleted automatically on any already-deployed instance.
Verified by reading the actual mechanism, not by inference *(verified
against `@servicenow/sdk` 4.9.0 — re-check if newer)*:

- `choice-set-plugin.ts` does have a real cleanup step —
  `choice-set-utils.js`'s `writeDeleteMultipleElement()` wipes SDK-owned
  `sys_choice` rows for a field before reinserting the current set. But
  it only runs `if (!isLegacy)` — i.e. only for the newer `sys_choice_v2`
  wrapper. If `legacyChoices: true` is set (see above), this cleanup is
  skipped entirely.
- Independent of legacy mode: that cleanup only fires while a field still
  declares a `choices` literal being processed at all. Once a field stops
  declaring `choices`, there's no choice-set build step left to trigger
  cleanup for it regardless of legacy mode.
- A real, explicit `Now.del(table, key)` API (`now-delete-plugin.js`) can
  emit a source-tracked `DELETE` record — but nothing generates it
  automatically from a removed declaration; you have to call it yourself.

Net effect: shrinking or removing a `ChoiceColumn`'s `choices` literal
leaves harmless-but-orphaned `sys_choice` rows on every already-deployed
instance, unless you delete them by hand (filter `sys_choice` by
`Name`/`Element`) or add explicit `Now.del()` calls.

### `report_type`-style column: don't default to Choice or Reference without checking the actual need

A column whose valid values live in another table (a type/kind registry)
has three real options, worth weighing explicitly rather than reaching
for the "obviously right" one:

- **`ChoiceColumn` with Dynamic Choice List** — only works if you also
  give the source field its own `sys_choice` set (see above); otherwise
  it silently offers nothing.
- **`ReferenceColumn`** pointing at the registry table — gives real FK
  integrity, but every comparison against the column's value now needs
  an extra resolution step (the field holds a sys_id, not the human-
  readable key), which can be a much bigger refactor than it looks if
  code elsewhere already does plain string comparisons against the
  column.
- **Plain `StringColumn`** — no native-form dropdown, no FK integrity,
  but zero resolution overhead and no orphaned-choice cleanup burden.
  The right fit when the field is only ever created/edited through your
  own widget UI (which can source its own picker from the registry table
  directly) and never through the native platform form.

### `Table()`'s `actions` field only gates Table API access — it has nothing to do with ACLs

`Table({actions: {read, create, update, delete}})` controls whether the
platform **Table API** (`/api/now/table/<name>`) exposes each operation
for that table — that's the entire scope of what it does. It does **not**
gate ACLs, native-UI create/edit/delete buttons, or any role-based
access — those are exclusively controlled by `Acl()` records (`sys_
security_acl`). Setting `actions.create`/`update`/`delete` to `false`
does not block a script's own `GlideRecordSecure.insert()`/`.update()`/
`.deleteRecord()` calls if a matching ACL grants it — this is exactly why
a table can (and, in a real app, commonly does) have every `actions` flag
false except `read` while still supporting real inserts/updates through
explicit ACLs alone. Never edit `actions` in response to an "add a role"/
"restrict write access"/"add an ACL" request — that's a different,
unrelated field.

### `Role()`'s `$id` is deprecated; `federatedId` is for identity federation only — neither is needed for a brand-new role

Per the SDK's own `Role` type doc comments (`@servicenow/sdk-core`'s
`app/Role.d.ts`): `$id` is explicitly flagged deprecated — "Role IDs are
now derived from `Role.name`," so a new `Role({name: ...})` call needs no
`$id: Now.ID[...]` at all (unlike `Acl()`, which still requires one).
`federatedId` is "Identifier used to match this role to an externally
federated role during identity federation" — only relevant if a role
needs to line up with an external SSO/federation-provided role, not
something to fabricate a value for when authoring a fresh, ordinary
in-app role. Don't copy an existing role file's `$id`/`federatedId`
shape into a new role without checking the type def first — an existing
role in a repo may itself predate this being deprecated, or may
genuinely need federation, neither of which generalizes to a new role
with no such requirement.

### A `Table()` `index` declaration reserves a `sys_index` id but the record is never written into the install package (SDK 4.11.0)

Traced through `@servicenow/sdk-build-plugins`' `table-plugin.js` after a
declared compound-unique index didn't seem to have any effect: the
`Table()` call-expression handler *does* construct a real `sys_index`
record for every entry in `index: [...]` (`factory.createRecord({table:
'sys_index', properties: {index_name, col_name_string, unique_index,
logical_table_name, index_col_name}})`) — a multi-column index just joins
`element` into a comma string (`['a','b']` → `'a,b'`). This record gets a
real, deterministic id, which shows up in the generated `keys.ts`
registry (`table: 'sys_index'`, keyed by `{logical_table_name,
col_name_string}`) exactly like any other tracked record.

**But no XML file for it ever appears anywhere under the build's output
directory** — confirmed by grepping the entire `dist/app/` tree (by
filename *and* by content — `col_name_string`/`logical_table_name`/
`index_col_name`, and the reserved id itself) for both a brand-new
compound index and every pre-existing single-column `index` block already
in a real, previously-deployed app: zero matches, across the board. The
plugin's own internal table-config for this record type
(`sys_index: {coalesce: [...], /* TODO: Need to implement
getUpdateName() ... */}`) has a literal unfinished-`TODO` next to it —
consistent with the record existing in the compiler's in-memory record
list but never actually being serialized to a file, rather than the
index logic itself being broken.

**Practical consequence**: don't trust a `Table()` `index` block (unique
or not) to actually land as a real database index/constraint on the
instance in this SDK version — it's currently a declarative no-op as far
as the packaged install artifact is concerned. If you need real
uniqueness enforcement (e.g. a many-to-many table that shouldn't allow a
duplicate pair), enforce it in script (check-then-insert, or a unique
combined-value field) rather than relying on `index: {unique: true}`.
Re-verify against `dist/app/` directly (grep for the record's reserved id
from `keys.ts`) before trusting this is fixed in a newer SDK version.

### A local module shared across 2+ *client-side widget bundles* is a real deploy-time hazard

A local module imported by two or more widgets' **client** (`index.js`)
bundles gets independently extracted into a `@shared/<name>-<hash>.js`
chunk **per bundling pass** — but only one pass's hash ever gets
registered as the deployed dependency record. Every widget bundle that
imported the module then references a chunk that was never actually
uploaded, which is a guaranteed 500 at runtime, with no build-time error
to catch it.

The fix isn't deduplicating the shared file — it's eliminating the
client-side shared module for that data entirely by moving it
server-side (a real table, or a server-only helper module imported only
by `server.js` files). Sharing a plain JS module across multiple
`server.js` files is safe and a well-proven pattern; sharing one across
multiple client `index.js` files is the dangerous case. If several
widgets need the same lookup/registry data, prefer: a real table +
one shared server-only helper (`getFoo()`) that every `server.js` calls,
with the client-side widget only ever consuming whatever the server
response already resolved — never a client-side constant/registry module
imported by more than one widget.

### Adding a new page-level decorator via a karuna patch (e.g. mirroring `@roles`/`@order`)

If a platform-level page field has no Fluent-level lever at all (karuna's
own metadata-record builder writes a hardcoded literal for it instead of
reading it from source), you can add a real decorator for it by patching
karuna, following the exact same shape as an existing page decorator
like `@roles(...)`/`@order(N)`:

1. Add a real, statically-extracted no-op decorator function alongside
   the existing ones in karuna's own decorators module (and its
   `.d.ts`), exported both individually and from the shared `decorators`
   namespace object.
2. Add a `readXFromSource(projectRoot, ssrPath)` function next to the
   existing `readRolesFromSource`/`readOrderFromSource`-style readers,
   using the same parse/find-class/get-decorator-arg shape they already
   use.
3. Wire the relevant metadata-record builder to call your new reader
   instead of its hardcoded literal.
4. Land all of it as one `pnpm patch` diff, folded into whatever patch
   file the project already has wired into its package manager's
   patch-dependency mechanism (see "Disabling widget bundle
   minification" above for the same `pnpm patch`/`pnpm patch-commit`
   workflow) — no new patch file needed if one already targets the same
   package version.

**Before trusting a new decorator built this way, test it on a page
under a dynamic `[param]` route folder, not just a static route** — every
source-reading decorator reader (including the pre-existing ones this
pattern mirrors) can share a single latent bug that silently no-ops
specifically on dynamic-segment pages, with zero build error. See
`pages-and-router.md`'s "Page-level decorators can silently no-op on
`[param]` dynamic-segment pages" for the full mechanism and the fix. A
new decorator built via this pattern inherits that bug automatically
(it goes through the same shared source-resolution utility every other
page decorator does) unless that utility has already been patched to
handle dynamic segments — verify in actual build output either way.

**A second, more fundamental failure mode: a symbol you add to karuna via
a local patch can build fine and even pass local dev-server testing, then
throw at runtime on a real deployed instance — because the package you
patched is externalized, not bundled.** Any `@servicenow/aiux-*`-namespace
package a project imports as a bare specifier (e.g.
`@servicenow/aiux-components-core`, where a page decorator's own
namespace object typically lives) is deliberately kept **out** of the
app's own client bundle by the isolate/client bundler's externalization
mechanism (the same `classifyExternal()`/`getModuleRegistryPackages()`
logic documented under "Local environment" → `AIUX_REPO_ROOT` above). At
runtime in the browser, that import resolves against
`globalThis.__moduleRegistry`, i.e. **whatever karuna component library
build the instance itself already has deployed** — the officially
released package, not your project's own `node_modules` copy. A brand-new
export you added purely via a local `pnpm patch` exists only in *your*
copy — the instance's own copy doesn't have it, so importing it for real
use (not just referencing its name in a build-time AST scan) throws
something like `TypeError: <name> is not a function` in the browser,
even though the build succeeded and even though every *pre-existing*
decorator/export from that same package works fine (they're already part
of the real shipped release the instance has).

**The fix**: don't import the new symbol from the platform package at
runtime at all, if the only consumer that actually needs it is a
build-time source scanner matching by name in the AST rather than by
resolved reference. A decorator-name reader like the one in the pattern
above typically matches `expr.callee?.value === decoratorName` — it has
no idea, and doesn't care, where the decorator was imported from. So
instead of importing the real decorator, define a **local, identically-
named no-op** in the page file itself (the same shape as the platform's
own no-op — e.g. `function hideChat(..._args) { return cls => cls; }`)
and decorate with that. This satisfies the build-time extraction without
ever touching the platform package's real (and, on the instance, still
un-patched) export at runtime — nothing for the instance's copy to be
missing. Every page that wants the new decorator needs this same local
stand-in, not the platform import, until/unless the symbol ever ships in
an official release of that package — at which point the local stand-in
can be dropped in favor of the real one.

**General lesson, beyond decorators specifically**: before adding *any*
new export to a package via a local patch, check whether that package is
one this app's bundler externalizes into the instance's own runtime
module registry. If it is, the new export is only trustworthy as
something a **build-time-only** consumer (an AST scanner, a build
plugin) can see — never as something your own widget/page code actually
imports and calls at runtime, since the instance's deployed copy of that
package won't have it. This is easy to miss because local dev/build
success gives no signal that this distinction even exists — the failure
only surfaces once the app actually runs against a real instance's
already-deployed component library.

### `AiAgent()`'s RAG tool: the bundled Fluent docs say `type: 'rag'`, but the actual `sdk-core` type defs only accept `type: 'search_retrieval'`

`@servicenow/sdk`'s own bundled markdown guides
(`node_modules/@servicenow/sdk/docs/guides/building-ai-agents-guide.md`,
`-tools-guide.md`, and `-advanced-guide.md`) all instruct you to author a
RAG Search tool's `tools[]` entry with `type: 'rag'` —
`-advanced-guide.md` even states explicitly: "**RAG naming**: Use `"rag"`
as the tool type in Fluent (not `"search_retrieval"`)."

This is wrong, confirmed directly against the actual shipped type
definitions rather than trusted at face value *(verified against
`@servicenow/sdk-core` 4.11.2 — re-check under a different version)*.
`dist/external/aiaf/tool-config.d.ts`'s discriminated union
`AiAgentToolDetailsType` defines the RAG-shaped variant (`RagToolDetails`,
carrying `inputs?: RagInputType`) only under **`type: 'search_retrieval'`**:

```ts
/** RAG tool - OOB RAG Search Retrieval tool */
type RagToolDetails = BaseToolDetails & {
    type: 'search_retrieval';
    inputs?: RagInputType;
};
```

And its own catch-all `GenericToolDetails` variant (the one every
otherwise-unrecognized `tool.type` string would normally fall through to)
explicitly `Exclude`s both `'rag'` and `'search_retrieval'` from itself:

```ts
type GenericToolDetails = BaseToolDetails & {
    type?: Exclude<AiAgentToolType, 'crud' | 'script' | 'capability' | 'subflow' | 'action' | 'catalog' | 'topic' | 'topic_block' | 'web_automation' | 'knowledge_graph' | 'file_upload' | 'rag' | 'search_retrieval'>;
    ...
};
```

So `type: 'rag'` doesn't structurally match **any** member of
`AiAgentToolDetailsType` — not the dedicated RAG shape, and not the
generic fallback either. Using it as the docs instruct is a genuine
TypeScript compile error, not just a style deviation from the "correct"
name. `'rag'` is still a legal literal in the separate `AiAgentToolType`
enum (`constants.d.ts`), which is likely why the docs' prose treats it as
valid — but the enum and the discriminated union that actually validates
`tools[]` entries are two different things, and only the union matters
for a real `.now.ts` file.

**Fix**: always use `type: 'search_retrieval'` for a RAG Search tool in
Fluent, never `type: 'rag'`, regardless of what the bundled guide's prose
or example code says.

**This is a genuinely generic `@servicenow/sdk` finding, not specific to
any one app's schema** — worth upstreaming into the source `aiux_claude`
template repo (this local copy won't sync back on its own — see this
project's own `CLAUDE.md`).

## Local environment

1. **Node version (`.nvmrc`)** — pin one, and run `nvm use` after
   pulling. Don't assume a global `node`/`now-sdk` on `PATH` matches.
2. **karuna** — an AIUX app depends on `@servicenow/karuna` (the karuna
   meta-package). `pnpm install` brings it in along with every
   `@servicenow/aiux-*` subpath the pages import.

   **`AIUX_REPO_ROOT` must be set correctly — it is not optional.**
   Karuna's isolate bundler calls `getModuleRegistryPackages(repoRoot)`,
   which scans `repoRoot/components`. When `repoRoot` doesn't exist (or
   points somewhere wrong) it returns an **empty set**, so
   `classifyExternal()` treats *no* `@servicenow/aiux-*` package as
   external. Instead of mapping them to
   `globalThis.__moduleRegistry[...]`, Rollup inlines their entire source
   into each page's SSR isolate bundle. Two consequences, both confusing:

   - Karuna component entry files resolve their build via a **top-level**
     `const mod = await import(\`./${version}/index.js\`)`. Once inlined,
     that top-level `await` lands in an `iife` bundle and the build dies
     with `Module format "iife" does not support top-level await`. The
     error names no file — this is a genuinely expensive thing to
     diagnose blind.
   - Even when the build passes, bundles balloon (megabytes instead of
     tens of KB) — see "Verifying a deploy actually landed" below.

   A correct `AIUX_REPO_ROOT` also silences a
   `components/dist/vN/manifest.json not found` build warning.

   Point it at the installed meta-package, e.g. in `.env`:

   ```
   AIUX_REPO_ROOT=<repo>/node_modules/@servicenow/karuna
   ```

   For internal monorepo development against an unpublished karuna
   build, a sibling `karuna/` checkout next to the project can be
   auto-detected by a setup script and written to `.env` instead.

   **If a script hardcodes this path directly rather than reading `.env`**
   (a real fallback used once when no `.env` existed at all), note it's
   then a **machine-specific absolute path** — update it (or rewrite it
   to derive the path relative to the project root, which is portable)
   before handing the project to another developer or another machine.

## First-time setup

```bash
nvm use
pnpm install
pnpm run types          # populates @types/servicenow/ (required for Now.ID)
pnpm run setup          # no-op when @servicenow/karuna is in node_modules;
                        # writes AIUX_REPO_ROOT to .env when using a sibling checkout
```

## Committing fluent metadata changes

Always stage the generated `Now.ID` registry file (commonly
`src/fluent/generated/keys.ts`) alongside any `.now.ts` changes. The SDK
regenerates this file during `pnpm run build` with new `Now.ID` entries —
it must be committed together with the metadata or the ID registry will
be out of sync.

## Deploy workflow

Use whatever top-level script orchestrates build + dist-sync + cache
clear + install as one step, rather than running the low-level install
primitive directly — a bare `now-sdk install` (or equivalent) typically
skips the build/sync/cache-clear steps and will leave stale bundles
serving.

What a well-formed deploy script should do, in order:

1. `now-sdk build` → writes the install payload to the configured output
   dir (`appOutputDir`, commonly `dist/app`). Watch for a secondary/debug
   metadata directory that `pack()` doesn't actually read — nothing needs
   copying out of it, and an old "sync step" copying between the two is
   often stale/dead code if the SDK version moved on.
2. Clear the AIUX runtime cache at `$AIUX_REPO_ROOT/.aiux-runtime` —
   without this, hashed bundles from the last deploy continue to serve.
3. `now-sdk install --reinstall` (or the project's equivalent) — packs
   the build output into a zip and pushes it to the instance.

If you see `Failed to delete application. Cannot invoke
"GlideRecord.getValue"`, the app is partially uninstalled; re-run a clean
reinstall rather than a patch-in-place install.

A plain install (patch, not create) expects the app's scope record to
already exist on the instance — it fails with something like `Unable to
install application as application was null` if the app was ever fully
deleted. A "clean install" flag/mode can **also** fail with that exact
error immediately after a successful uninstall — don't assume a clean
reinstall is automatically a safe fallback from a patch-install's
failure; both can hit the same wall (see the recovery playbook below).

### Alternative: deploying via update sets (a "configuration" install type)

A second, structurally different install path is often available,
useful when the normal scoped-app zip install is broken for reasons
unrelated to your actual code changes — check whether your SDK version
exposes a `"type": "configuration"` (or equivalent) mode in its config
file. When available:

- Same build output — no separate build step.
- Every metadata XML file gets uploaded via a different API endpoint
  from the zip-upload processor, so it sidesteps whatever's broken there.
- Lands in an **update set** (creates one, or targets an existing one)
  rather than being auto-committed — you review/complete it yourself.
- **Typically does not touch the app's own scope/definition record**
  (`sys_app`-equivalent) — this mirrors a well-known platform limit:
  scope/app definition records usually aren't captured by ordinary
  Update Set business rules the way normal record changes are. Only
  matters if you're changing those specific fields; table/widget/
  page/ACL metadata changes work fine through this path.
- **No dependency-ordering guarantee**, if the underlying implementation
  just pushes files in filesystem order with no sort — unlike the full
  package-install path, which usually does sort metadata-dir-first. In
  practice this may not matter for a given failure (confirm by checking
  file order in both a broken and working build before assuming
  ordering is the cause of anything) — don't assume it's safe by design
  just because it happened not to bite once.
- May not clear the runtime cache the way the main deploy script does —
  run that step manually if stale bundles seem to be serving after a
  config-mode deploy.

## Verifying a deploy actually landed

**A malformed record can be skipped silently.** The instance can accept
an install and report success while dropping individual records, so
"deploy succeeded" is not evidence the app actually works. A dropped
layout/page record commonly shows up as a generic "not configured"-style
error in the browser and 404s on affected routes.

Check locally before blaming the instance — oversized files are the
tell. For widget XML records, something like:

```bash
for f in dist/app/update/sys_aix_widget_*.xml; do
  printf '%s %s ' "$(du -h "$f" | cut -f1)" "$(basename "$f")"
  python3 -c "import xml.etree.ElementTree as ET;ET.parse('$f');print('valid')" \
    || echo INVALID
done
```

Healthy widget records are typically tens of KB. Multi-MB files usually
mean karuna source got inlined (see `AIUX_REPO_ROOT` above) and can embed
a literal noncharacter from minified PostCSS output that's illegal in
XML 1.0 — which is exactly what makes the instance drop them.

To confirm on the instance, check the app's Application Files list for
the widget/page/layout records you expect, and keep a running checklist
(one row per widget/page/layout) as the app grows — update it every time
a new widget ships, distinguishing internal (page/layout widgets) from
custom (everything else) if your project uses that convention.

## Do not patch karuna's `await import()` shims

Karuna component entry files commonly use a pattern like:

```js
const version = process.env.AIUX_VERSION || 'vN';
const mod = await import(`./${version}/index.js`);
```

**Do not replace this with a static import** even if a build fails on
its top-level `await`. The dynamic form is deliberate: the isolate
bundler's dynamic-import resolution hook intercepts it and either maps
it to an isolate runtime global or stubs it to `{}`, so the component
library is never inlined. A static import defeats that hook, forcing the
bundler to inline the whole library transitively (dragging in its own
CSS toolchain and any illegal-XML-character risk with it). It converts a
loud build failure into a **silent install failure** — strictly worse.

The top-level-await error is almost always a *symptom* of a bad
`AIUX_REPO_ROOT` (see above), not a bug in the shim to patch around. If a
build ever fails on top-level await, the error typically names no file —
temporarily logging the underlying bundler's own error id in the build
CLI's catch block (then reverting the edit) is the fastest way to find
the actual offending module.

**This is not tied to one karuna version.** The shim shape above was
confirmed byte-identical across two different karuna versions used on
the same project (22.26.0 and 22.50.0) — i.e. upgrading karuna neither
caused nor fixed the underlying `AIUX_REPO_ROOT` issue; both versions hit
the identical top-level-await failure mode when `AIUX_REPO_ROOT` was
wrong, and both worked identically once it was set correctly. Don't treat
a karuna version bump as a fix (or a cause) for this class of symptom —
check `AIUX_REPO_ROOT` first regardless of which version you're on.

## A dynamic `import()` of a plain (non-`@servicenow/*`) npm package is stubbed to `{}` in the SSR isolate bundle — a real lever for browser-only libraries

Confirmed by reading `build-isolate-bundle.js`'s `createIsolateGlobalsRollupPlugin`
directly, not guessed *(verified against `@servicenow/karuna` 22.50.0 —
re-check under a different version)*: its `resolveDynamicImport(specifier)`
hook classifies every dynamic `import()` call site in the module graph. A
specifier that isn't externalized (not `lit`, not
`@servicenow/aiux-components-core`, not a `@servicenow/glide-widgets/...`
widget, not a registered `@servicenow/aiux-*` component) resolves to a
virtual stub module (`export default {};`) instead of being bundled for
real — "Dynamic imports are CSR-only lazy loads," per the plugin's own
comment. A **static** import of the same package has no such protection —
it resolves normally through the ordinary `resolveId` path and gets
bundled inline, real source and all, regardless of whether the SSR path
ever calls into it.

This is a genuine, usable lever for a component that needs a browser-only
library — one that touches `window`/`document` and would misbehave or be
dead weight inside the Node-based SSR isolate (DOMPurify is the concrete
case that surfaced this: it requires a real DOM to sanitize anything, and
does nothing useful in Node). **Dynamically importing it from a place
that only ever runs client-side — Lit's `firstUpdated()`, never
`connectedCallback()`/`render()`, both of which also run during SSR —
keeps the real library out of the SSR isolate bundle entirely.** Confirmed
empirically: a widget that dynamically imports `marked`+`dompurify` this
way produced a named stub (`_isolateStub_<name>`, an empty object) in its
isolate bundle, while the browser bundle correctly code-split the real
libraries into their own separate, lazily-loaded chunks — no inflation of
either the always-loaded client bundle or the widget's XML-embedded SSR
bundle.

**Do not statically import a browser-only library at a widget's module top
level**, even if every call site is guarded and only ever runs
client-side. The isolate bundler's stub-on-dynamic-import protection only
applies to the `import()` call site's own specifier resolution — a static
`import` at the top of the file unconditionally bundles the real module
into the SSR isolate output, because that decision is made at
module-resolution time, before any runtime guard around its *usage* is
ever evaluated. Guarding the call with `isServer` (from `lit`) is still
necessary for correctness (the library still can't do anything useful
without a DOM even if it were bundled) but does **not**, on its own, keep
the library's source out of the SSR bundle — only using dynamic
`import()` for it does that.

This also doubles as a practical, general SSR-opt-out for one piece of a
widget's rendering that genuinely can't run during SSR, in the absence of
any full-widget "disable SSR" flag — checked `AIUXWidgetElement`'s/
`AIUXElement`'s own type defs; no such switch exists. The pattern: render
a plain/fallback version in `render()`, gated on a client-only-set state
flag; dynamically `import()` the real dependency from `firstUpdated()`;
swap to the full version once it resolves, via the same state flag
triggering a normal reactive re-render.

## Disabling widget bundle minification (a real but risky lever, if you ever need it)

There is often **no official on/off switch** for this — check the config
schema and build-plugin source for any `minif*` flag before assuming one
exists. Minification frequently lives entirely inside the shared UI
runtime package (karuna or equivalent), via one Rollup `renderChunk`
plugin wrapping a real minifier (e.g. SWC's `minifySync`).

To find the real call sites for your version: trace the actual import
chain the build CLI uses (not every file that merely mentions
"minify" — some hits are in an unrelated browser/live-preview bundle
path that a Node CLI build never reaches). Expect **two** genuinely
distinct call sites feeding into one widget's deployed XML record:

1. One building the **client-side (browser) bundle** — not
   widget-specific; typically shared with the app's lifecycle bundle and
   page/layout bundles too. Patching this un-minifies the whole app's
   client output, not just widgets.
2. One building the **SSR "isolate" bundle** — this one usually *is*
   widget-specific, since its output is what gets embedded verbatim into
   the widget's metadata XML (size here is literally XML size).

**Patching only the SSR-bundle site does not get you a fully unminified
widget** — the browser bundle (site 1) is typically what actually
executes client-side and is written into the record's main component
field; the isolate bundle (site 2) only covers the SSR/hydration path.

Both real call sites are commonly hardcoded with no env var or CLI flag
gating either one — un-minifying requires patching the plugin arrays
directly (delete the minify-plugin line, or make it conditional the way
some adjacent debug/visualizer plugin already is in the same file, as a
precedent that a falsy/undefined plugin-list entry is tolerated).

If a `pnpm patch`-style mechanism is already wired up for the shared UI
package in the project, that's the place to make this change; otherwise
set one up. Caveats before doing this:

- Un-minified is not the same as original source — a prior SWC/TS-lowering
  transform step usually still runs before minification, so skipping
  only the minify plugin gets you that intermediate lowered form, not
  literal source.
- Isolate bundle size feeds directly into widget XML size — see
  "Verifying a deploy actually landed" above. Un-minifying can push
  bundles into the danger zone even without a separate externalization
  bug compounding it.
- A patch is a diff against one specific package version's file
  contents — if that package's pin ever moves, the patch may need
  re-diffing.
- This does not selectively un-minify "your code" within a bundled
  chunk — a `renderChunk` hook sees the whole chunk as one blob, with no
  distinction between your source and inlined `node_modules` code. A
  third-party library that ships **pre-minified** ESM (many chart/vendor
  libraries do) is a non-issue either way; a library that ships
  unminified ESM expecting the consumer's bundler to minify it would come
  out fully readable too if this is patched off — there's no per-module
  opt-out, only per-chunk.

## Use the local CLI, not a global or `npx`-resolved one

A global CLI binary on `PATH` may be a different version than the one
pinned in `package.json` — always go through the project's own scripts
(`pnpm run <script>`, which prepends `node_modules/.bin`) so the pinned
version is what actually runs. Don't convert those scripts to `npx`: on a
local-resolution miss, `npx` can silently download the latest version
from the registry and run *that* instead — dangerous specifically for
any tool that generates a deterministic ID registry file, since a
version mismatch there can desync IDs across the team. Fluent sources
also typically import from the SDK's own subpaths (`@servicenow/sdk/core`,
`@servicenow/sdk/global`), which only resolve from local `node_modules` —
a global CLI can't satisfy those regardless.

## Registry auth (first-time install)

If the project pulls internal-scoped packages from a private registry,
`.npmrc` needs the bare `registry=` line mapped to that registry, not
just the specific scopes — a karuna-style meta-package can pull in
unscoped internal packages too, and without the bare `registry=` line
those fall through to the public npm registry and 404. A personal
`_authToken` for that host, in the user's **global** `~/.npmrc` (not
committed), is typically required on top of the project-level mapping.

## Running the dev server locally

- Find the actual entry point in the startup log — it's often not one of
  the internal service ports also logged.
- This is typically a **reverse proxy in front of a real instance**
  (configured via an env var or a config file's dev-origin setting) —
  local build output serves the JS/templates; everything else (session,
  login, data) is proxied through to that real instance.
- **Routes can 404 until the app has been deployed at least once** — the
  dev router may resolve experience/page registration against the
  connected instance, not from local build metadata.
- **Login is the real instance's login** — you'll get redirected through
  its actual login page. A scaffold placeholder credential in a dev
  config file is not guaranteed to be a valid login.
- Responses may be compressed (e.g. Brotli) — plain `curl` won't show
  readable output without decompressing first.
- **A burst of near-simultaneous widget server calls can 502 locally but
  not on the real instance.** If several widgets independently fire their
  own server call at nearly the same moment (e.g. several tiles mounting
  in quick succession) and you see real 502s only against the local dev
  proxy, that's very plausibly a dev-proxy/local-concurrency limit, not
  an application bug — confirm by testing the same sequence against a
  real deployed instance before chasing it as a widget code defect.

### Where the dev server's upstream instance comes from

Often **not** primarily a project config file — commonly defaults to
whatever instance you're authenticated to via the CLI's own auth command.
A project config file is usually only an override; an empty/unset
override in the config loader is expected, not a bug. Typical
precedence, highest first:

1. An environment variable (shell, or `.env`).
2. A project config file's dev-origin override.
3. The authenticated credential's own origin (the real default).

**If dev proxies to the wrong instance, check your CLI auth session
first**, not the project config file. Force a specific target with the
environment variable if needed.

## Known issues

- **Deleting a `.now.ts` source file *does* produce a real `action="DELETE"`
  update record on the next build (verified against `@servicenow/sdk`
  4.11.0 — re-check if newer) — contrary to this file's own narrower
  "nothing generates a DELETE automatically" claim above, which was
  specifically about a shrunk `ChoiceColumn` `choices:` literal, not about
  removing an entire `Table()`/`Acl()`/`ScriptInclude()`/business-rule
  declaration.** Confirmed directly, not guessed: removing a table (along
  with its `Acl()` records and related business rules) and running `pnpm
  run build` produced two things: (1) `src/fluent/generated/keys.ts` kept
  every one of those records' old `Now.ID` entries but tagged each with a
  new `deleted: true` property (the registry doesn't forget an id just
  because its source is gone — plausibly so a real delete can still
  target the right sys_id later); (2) `dist/app/author_elective_update/`
  (a **different** directory from the main install path's
  `dist/app/update/`) contained a genuine `action="DELETE"`-style record
  for every removed table/ACL/business-rule/script include, each just a
  bare `sys_id` + `sys_scope` + `sys_update_name` — the real payload
  isn't needed for a delete.
- **That DELETE record lands in the "elective" bucket, not the main
  package — it will not apply itself on an ordinary `now-sdk install`/
  `pnpm run deploy`.** `author_elective_update` reads as: "here's a
  record change available for this app, opt-in rather than automatic" —
  consistent with this file's own "configuration"/update-set install
  mode section above (a distinct install path that uploads metadata XML
  directly, sidestepping the normal zip-install processor). Don't assume
  removing source and redeploying is sufficient to actually delete a
  record from a live instance that had a prior version installed —
  verify whether your project's deploy path actually consumes
  `author_elective_update` content, and if it doesn't, some deliberate
  extra step (the update-set/configuration install mode, or a manual
  cleanup on the instance) is needed to actually apply these deletes
  live. Two secondary artifact types were observed to be left completely
  orphaned even by this mechanism — no DELETE record generated for
  either — matching this file's separate, pre-existing finding on
  orphaned `sys_choice` rows above: a removed `ChoiceColumn`'s
  `sys_choice` rows, and `sys_documentation` (field help-text) rows for
  any removed column. Both need the same manual "filter by Name/Element
  and delete" cleanup this file already documents for orphaned choices.
- **The same behavior applies to deleting an AIUX *page directory*, not
  just a `.now.ts`** — confirmed against `@servicenow/sdk` 4.11.2 by
  deleting a `pages/<route>/` directory and inspecting the build output.
  A page contributes three records (`sys_aix_page`, its page-widget
  `sys_aix_widget`, and the `sys_aix_experience_page_rel` link), and
  removing the directory produces a real `action="DELETE"` record for
  each — all three into `author_elective_update/`, none into the main
  `update/` path, with all three ids kept in `keys.ts` and tagged
  `deleted: true`. So the same "an ordinary deploy will not actually
  remove these from an already-installed instance" caveat applies to a
  deleted page. Don't assume a page's records are gone from an instance
  because its route stopped resolving; the nav item disappearing and the
  records being deleted are two different things.
- **A brand-new `ChoiceColumn` choice value — not just a removed one —
  also lands in `dist/app/author_elective_update/`, not the main
  `dist/app/update/` install path, at least under `legacyChoices: true`.**
  Confirmed directly: adding new choice values to an existing
  `ChoiceColumn` and running `pnpm run build` produced an
  `author_elective_update/sys_choice_<table>_<field>.xml` file containing
  the new values with correct `sequence` numbers — and this bucket held
  **every** choice value for that field, old ones included, not just the
  new additions; the entire `sys_choice_set` wrapper for a `ChoiceColumn`
  appears to be elective, additive changes and all, not something
  specific to deletes. **Unverified**: whether the ordinary `now-sdk
  install`/`pnpm run deploy` path actually consumes
  `author_elective_update` content for this additive case — the
  "elective, opt-in, not automatic" reasoning above for the DELETE case
  may or may not generalize to a same-bucket addition. Don't assume a
  new choice value will show up live after an ordinary deploy without
  checking; if it doesn't, the same update-set/configuration install
  mode (or a manual `sys_choice` insert) documented as the DELETE
  workaround above is the likely fix.
