# Glide Platform Facts

## Server-script Glide APIs — verified facts

Widget server scripts run against the platform Glide APIs, and guessing
method names here is expensive. Two things established the hard way:

### `GlideRecord.addSelect()` does not exist

It was invented by a previous session, written into application code,
and then in a *later* session read back out of that file and cited as
evidence the code was already optimized. Multiple conclusions rested on
it before it was caught. This is the canonical example of why "existing
code in this repo" is never verification on its own — it may itself be a
prior session's guess.

**`GlideRecord` has no field-selection API at all** — no `addSelect`, no
`setFields`. A GlideRecord query always fetches every column. The only
adjacent real methods are `addExtraField()` (adds, doesn't restrict) and
`chooseWindow()` (rows, not columns).

Verify any Glide API against the type definitions before use:

```bash
grep -rn "methodName" @types/servicenow/glide.server.d.ts        # pnpm run types
grep -rn "methodName" node_modules/@servicenow/glide/src/types/  # incl. GlideQuery.d.ts
```

These are thorough enough to include genuinely obscure real methods
(`addExtraField`, `setAggregateWindow`, `getFieldsWithDotPathReferences`),
so **absence is strong evidence the method isn't real**. Never treat
existing code in a repo as verification — it may be a previous session's
guess.

### GlideQuery: available, but strictly less capable for common needs

Typed under the platform's own `GlideQuery.d.ts`, and often implemented
as global-scope script includes on the instance (`GlideQuery`,
`GlideQueryEvaluator`, `GlideQueryActions`, `GlideQueryParser`) — so its
source is readable, and should be read rather than assumed. Findings,
all from that source:

- **`select()` does not restrict columns.** It's a result *projection*.
  The field list is used only for schema-field validation; the
  underlying GlideRecord receives just an encoded query +
  `setLimit()`. So `select('a','b')` saves no DB I/O versus a plain
  query, and the usual "GlideQuery is faster because it selects fewer
  columns" claim doesn't hold on field width. What does hold: `.count()`
  compiles to a real aggregate `COUNT` rather than materializing rows.
- **`withAcls()` can silently no-op on aggregates.** It appends an inert
  step that's only actually read on the non-aggregate path — the
  aggregate branch of the underlying record-creation logic returns
  *before* the check that matters. So `.withAcls().count()` can run
  **unsecured with no error**. A security-data-filter equivalent can
  survive onto aggregates even when ACLs don't — don't assume "I called
  `withAcls()`" means a count is actually ACL-filtered; verify against
  the specific method chain and platform version.
- **GlideQuery may never expose the underlying GlideAggregate**, making a
  raw-GlideAggregate `canRead()`-gating pattern impossible through it —
  a `toGlideRecord()`-style escape hatch's own type-def comment claiming
  otherwise should be verified against actual behavior, not trusted at
  face value.

Net: for many server-script needs, GlideQuery can offer **strictly less**
control than raw `GlideRecordSecure` / `GlideAggregate`. Don't migrate an
existing, working raw-API implementation to GlideQuery on the assumption
that it's a strict upgrade — verify the specific capability you need
(ACL-secured aggregation, field restriction, etc.) actually works the way
you expect first.

### `canRead()` is table-level, not row-level

Per the platform's own type-def doc comments — "permit reading records in
this table." Useful as a cheap access gate; it cannot produce an
ACL-accurate row count or filter individual rows. Row-level filtering
only happens inside `GlideRecordSecure`, which drops denied rows during
`next()`. A `GlideAggregate`-based count is **not** ACL-aware regardless
of any `canRead()` check performed alongside it — a `canRead()` gate and
an ACL-accurate count are two different guarantees; don't let one stand
in for the other in anything that reports a count or total back to the
user (see the aggregate-vs-secure-query tradeoff above).

### `GlideRecordSecure.insert()` requires a `write` ACL, not just `create`

Confirmed by live debugging on a real instance: a non-admin user with the
role granted on a table's `create` ACL, and for whom `canCreate()` returns
`true`, can still have `GlideRecordSecure.insert()` silently do nothing —
no thrown exception, `insert()` just doesn't produce a record. Two other
data points pinned down the cause:

- Switching the same code from `GlideRecordSecure` to plain `GlideRecord`
  made it work immediately — plain `GlideRecord` doesn't enforce ACLs at
  all, so this is an ACL-enforcement issue specifically.
- An admin account never hit the issue — admin/`security_admin` bypasses
  ACL enforcement entirely, so it can't surface there regardless of which
  ACLs exist.

**Root cause**: `GlideRecordSecure`'s security manager evaluates `write` as
its own distinct ACL operation type (separate from `create`/`read`/
`delete`), and treats it as required during insert — setting field values
as part of creating a record apparently also needs `write` access, not
just `create` access on the table. `canCreate()` only reflects the
`create` ACL, so it reports `true` even when the missing `write` ACL is
what will actually block the insert. This is easy to miss: a table that
only has `create`/`read` ACLs (a very natural set to author for an
append-only/insert-only table, since nothing should ever need to *update*
an existing row) can still need a `write` ACL purely to allow the initial
insert.

**Fix**: any table a non-admin role needs to `GlideRecordSecure.insert()`
into needs a `write` ACL for that role, in addition to `create` — even if
the table is otherwise never updated after insert (an append-only/
insert-only table with no `update` table action and no `delete` ACL can
still need an explicit `write` ACL before non-admin inserts will actually
persist).

**Consequence for anything that creates records via `GlideRecordSecure`**:
audit every table your app inserts into this way and confirm each one has
both a `create` ACL *and* a `write` ACL for the relevant role — a missing
`write` ACL is silent (no error surfaced anywhere) and easy to overlook
since `create`-only looks complete and correct on its own.

### A `javascript:` default-value script on a date/time field needs `GlideDateTime.getDisplayValue()`, not `.getValue()`

Confirmed by live testing on a real instance: a dictionary `default_value`
script (e.g. a Fluent `DateTimeColumn({default: 'javascript:...'})`) that
returns `(new GlideDateTime()).getValue()` — the UTC internal-storage
string — stores the **wrong** instant whenever the evaluating session's
time zone isn't UTC. `(new GlideDateTime()).getDisplayValue()` — the
value converted to the evaluating session's own time zone — is the one
that actually produces the correct stored timestamp.

This is the opposite of what the type most other Glide APIs return for
storage/comparison purposes would suggest (`getValue()` is normally the
"give me the real, storage-safe form" call — see `canRead()`/`groupBy()`
entries elsewhere in this file for other cases where the "obviously safe"
API isn't). The likely mechanism: a default-value script's result isn't
applied to the field directly as a raw internal value — it's run through
the same interpretation path as if a user had typed that string into the
field in the browser, which expects a **display**-formatted string in the
current session's time zone/format and converts it to internal storage
from there. Feeding it an already-UTC `getValue()` string makes that
conversion double-apply the timezone offset. Since the script's own
`getDisplayValue()` call and the platform's later re-interpretation of
that string both happen under the same evaluating session, the round trip
is self-consistent and lands on the correct real "now" — this isn't
special-cased to any one particular field name, it should generalize to
any date/time-typed field's default-value script.

Don't assume `.getValue()` is the safe default for a default-value script
just because it's the safe choice almost everywhere else a `GlideDateTime`
value needs to go into storage or a query (encoded queries, `setValue()`
calls, etc. still want `.getValue()` — this is specific to the
default-value-script evaluation path). Re-verify if you're setting a
date/time field's initial value any other way (a Business Rule's
`setValue()` on insert, for instance) rather than assuming this
default-value-script finding carries over.

### A `BooleanColumn`'s `getValue()` is `'0'`/`'1'`, not `'true'`/`'false'` — use `getDisplayValue()`

Confirmed directly (`gs.info` against a real column, not guessed): for a
`true`/`false`-typed `BooleanColumn` field, `GlideRecord.getValue()`
returns the string `'0'` or `'1'`, **not** `'true'`/`'false'`.
`getDisplayValue()` reliably normalizes it to `'true'`/`'false'`.

This is the opposite of what you'd expect from the date/time
default-value-script finding elsewhere in this file (`getValue()` is
normally the "safe, storage-form" call to reach for) — don't let that
precedent carry over to a boolean check. Comparing `getValue(field) ===
'true'` (a pattern that can look reasonable by analogy to other
boolean-ish comparisons elsewhere in a codebase) will silently and
permanently evaluate `false` for a real `true` value, with no error
anywhere to catch it. Always branch on a `BooleanColumn` via
`getDisplayValue(field) === 'true'`, never `getValue()`.

### `GlideAggregate.groupBy()` can silently omit the group for a blank/empty value

Confirmed on a live instance (2026-08-22): `GlideAggregate.groupBy(field)`
does not reliably surface a distinct group for a blank/empty value of
`field` the same way it does for a real one. A field with some records
genuinely blank on it can produce a set of grouped counts that **sums to
less than the table's real total** — the shortfall isn't an error, isn't
a zero-count group, it's just missing, silently.

This breaks any code that implicitly assumes "the sum of every
`groupBy()` group's count equals the table's total record count" — a
very natural assumption to make, and one that holds for every group with
a real value, which is exactly what makes the blank-value gap easy to
miss in testing (it only shows up once a blank value actually exists in
the data and happens to matter to whatever you're building).

**Fix pattern**: don't trust `groupBy()`'s own output as a complete
partition of the table. Independently compute the real total (a separate
`GlideAggregate` with `addAggregate('COUNT')` and no `groupBy()`, or an
equivalent plain count) and compare it against the sum of the grouped
counts you actually got back. Treat any positive shortfall as belonging
to an implicit blank/empty group — fold it in as its own explicit group
(competing for a kept/ranked slot the same as any real value, not
appended unconditionally) rather than letting it silently vanish from
whatever you're building (a chart, a report, a breakdown UI). If
`groupBy()` happens to already return a blank group with a nonzero
count on some platform version/dataset, this reconciliation is a no-op —
safe to apply unconditionally rather than only when you've confirmed the
gap exists on your specific instance.

### `field IN <comma-list>` does not match a blank/empty value — use `field ISEMPTY`

An encoded-query condition like `fieldINvalue1,value2` does **not** match
records where `field` is blank/empty, even if you try to work around it
by including an empty element in the comma list (e.g.
`fieldINvalue1,,value2`) — the `IN` operator doesn't treat that as "or
blank." If you need to match a blank value alongside a set of real ones
in a `GlideAggregate`/`GlideRecord` query, use a separate `fieldISEMPTY`
condition for the blank case, not a trick with the `IN` list.

This matters most when a query needs to be split by two fields at once
(e.g. a joint `groupBy(fieldA, fieldB)` filtered to specific kept values
on each side) and either field's kept-value set can include a blank.
Rather than trying to build one combined query with `^OR`-joined
blank/non-blank branches on both sides (real precedence risk once you
have more than one `^OR` group in a single encoded query, and easy to
get wrong without independently verifying the platform's actual
AND/OR grouping behavior for that specific shape), it's safer to split
into separate, unambiguous **AND-only** queries — one per real/blank
combination that's actually possible (real×real, blank×real, real×blank,
blank×blank, as needed) — each using `IN` for the real side and `ISEMPTY`
for the blank side, and merge their results in script. More queries, but
each one is trivially correct on its own, with no encoded-query
precedence subtlety to get wrong.

**Why this can matter more than it looks**: if a downstream consumer of
a filtered/joint query has no "leftover bucket" to catch what the query
misses (e.g. no "Other" node to absorb an uncaptured flow because the
relevant side is already under whatever cap triggers an overflow
bucket), a blank value silently failing to match via `IN` doesn't just
undercount — it can produce a **complete, silent gap** in whatever
you're building (zero links/records for that value, no error, nothing
to signal it happened). Don't assume a missing "Other"-style bucket
means there's nothing to catch; it can also mean there's nothing
catching a bug like this one.

### Database Views aren't reachable via `super_class` walk-up, and their generated column names encode the real source field

Confirmed against the platform's own typed schema, not guessed —
`sys_db_view_table` (`view`: reference to `sys_db_view`; `table`: a plain
Table Name field, so `getValue('table')` returns the real table's
technical name directly, no further sys_id resolve needed;
`variable_prefix`: String; `active`: Boolean) and `sys_db_view` (`name`,
`label`, `description`, `plural`).

Two separate facts follow from this schema, both easy to miss if the only
"a table might not have its own dictionary row for a field" case you've
handled is ordinary table-extension inheritance:

1. **A Database View is not part of any table's `super_class` chain.**
   Code that resolves a field's real definition by walking a table's
   `super_class` chain up to find which ancestor actually defines it (the
   standard fix for "this table inherits a field with no dictionary row
   of its own") will never reach a Database View's underlying joined
   tables this way — a view isn't an ancestor or descendant of anything,
   it's an unrelated join construct. Any dictionary-lookup helper that
   assumes inheritance is the *only* reason a table might lack its own
   row for a field needs a second, unrelated fallback specifically for
   views.
2. **A Database View auto-names its generated columns
   `<alias>_<real field name>`**, where `<alias>` is
   `sys_db_view_table.variable_prefix` — the join alias set when that
   table was added to the view (blank for the view's own unprefixed
   anchor/primary table). To resolve a view's generated column (e.g.
   `inc_sys_created_on`) back to the real `(table, field)` it's actually
   defined on: query `sys_db_view_table` filtered to
   `view.name=<viewName>` (a dot-walked query condition — resolves the
   same way through `GlideRecordSecure` as plain `GlideRecord`) and
   `active=true`, collecting each joined table's real name and its
   `variable_prefix`. Check, in order: (a) does the column name start
   with `<prefix>_` for any joined table with a non-blank prefix — a
   prefix match is a much stronger signal than a same-named field
   coincidentally existing elsewhere, so check it first, across every
   joined table, before falling back to (b) any joined table with a
   **blank** prefix (the common shape for the view's anchor table),
   using the column name unchanged. Once resolved, recursing the normal
   dictionary lookup against that real `(table, field)` pair also
   correctly picks up ordinary `super_class` inheritance on that table,
   if any — the view-resolution step and the inheritance-walk step
   compose cleanly; neither needs to know about the other.

**Consequence for anything that lets a user pick a "table"** (a
typeahead search, a reference-style picker, etc.): `sys_db_view` is a
**separate registry from `sys_db_object`**, with its own independent
`name`/`label` pair — a view's friendly label doesn't necessarily live
anywhere on its `sys_db_object` row. A search that only queries
`sys_db_object` can miss a Database View the user expects to find by
that label, even though the view is fully queryable via
`GlideRecordSecure`/`GlideAggregate` by name exactly like a real table
once it's actually selected. A table picker meant to support Database
Views has to search both tables and merge results (deduped by table
name) — searching `sys_db_object` alone is not sufficient just because a
view happens to also be queryable like one.

### `global.GlideImpersonate` is real — a platform-provided OOB script include, not absent from the platform

Confirmed directly against a real instance: `global.GlideImpersonate()`
(global scope — hence the `global.` prefix when calling it from a scoped
app) is a real, platform-provided out-of-box script include, usable e.g.
as `(new global.GlideImpersonate()).impersonate(userSysId)` from a
scoped-app server script (a sys_trigger script, in the confirmed case).

**General lesson**: a project's generated `@types/servicenow` type defs
(populated by whatever a `pnpm run types` pull happens to cover) are not
a complete inventory of every class that exists on a real instance —
that pull can simply miss an OOB script include. The "absence is strong
evidence the method isn't real" methodology used elsewhere in this file
(e.g. `GlideRecord.addSelect()`) holds for a *platform core* API that a
thorough type-def pull would be expected to include; it does not
reliably extend to an OOB script include, especially a global-scope one,
where absence from the local type defs is much weaker evidence. Don't
conclude a `global.*` script include doesn't exist just because it's
missing from local type defs — verify against the instance (or ask)
before treating a type-def gap as proof of non-existence for anything
outside core Glide server APIs.

`GlideSession` (via `gs.getSession()`) separately, genuinely also
exposes `impersonate(userSysId)`/`onlineImpersonate(userSysId)`/
`onlineUnimpersonate()` (confirmed in `glide.server.d.ts`) — a real,
different API, not a replacement for `GlideImpersonate`. Which one a
given script should use is a judgment call, not something this file
should dictate either way.

### A Scripted REST API route has no multipart/form-data parsing API — file uploads must go through base64 + `GlideSysAttachment`

Grepping `@types/servicenow/glide.server.d.ts`'s `sn_ws_int` namespace
(`RESTAPIRequest`/`RESTAPIRequestBody`/`RESTAPIResponse`) for
`multipart`/`Multipart` returns zero matches — there is no framework-level
multipart-form-field parser exposed to a Scripted REST route's script,
only `request.body.data` (JSON-parsed body), `request.body.dataString`
(raw string), and `request.body.dataStream` (raw stream). A route meant
to accept file attachments has to receive them as base64-encoded content
inside an ordinary JSON body field, then hand that to
`new GlideSysAttachment().writeBase64(gr, fileName, contentType,
contentBase64)` (or `.writeContentStream(...)` off the raw stream) —
there is no true `multipart/form-data` POST support to reach for instead.

## `sys_amb_processor` advanced-authorization/listener scripts need the scope-qualified Script Include name, not the bare class name

A `sys_amb_processor` record's embedded scripts (`channel_create_advanced_authorization`,
`channel_subscribe_advanced_authorization`, `message_send_advanced_authorization`,
`message_receive_advanced_authorization`, `message_send_listener`,
`message_receive_listener`, etc.) run in a context where a scoped app's own
`Class.create()`-style Script Include is **not** resolvable by its bare
class name (e.g. `MyScriptInclude.someMethod(...)`) — calling it that way
throws, and the platform logs it as something like:

```
[AMB] ScriptedAMBProcessor Handler authorizeSend at Processor <name> failed
to evaluate due to an exception in the script with the variables: {...}: no
thrown error
```

Note the exception carries **no message** ("no thrown error") — this is a
generic wrapper around whatever failed to resolve, not a hint about the
actual cause. It is not related to `sandboxCallable` (ruled out — plain
Script Include calls from AMB processor scripts are not restricted by that
flag) and is not a GlideRecordSecure/ACL issue either.

**Fix, both required together:**
1. Reference the Script Include by its **scope-qualified name**
   (`<scope>.MyScriptInclude.someMethod(...)`), not the bare class name,
   from inside any `sys_amb_processor` embedded script.
2. Set `accessibleFrom: 'public'` on that Script Include's Fluent
   definition (`ScriptInclude({...})`) — it defaults to `'package_private'`
   (this-scope-only), and the AMB processor script context needs the
   Script Include to declare itself accessible from outside its own scope
   even when the processor record itself lives in the same app scope.

Don't assume a Script Include already callable from ordinary in-scope
server scripts (widget `server.js`, Business Rules, etc.) is automatically
callable from a `sys_amb_processor` embedded script the same way — verified
here to need both the scope prefix and `accessibleFrom: 'public'` even
though the processor record and the Script Include are deployed in the
same app scope.
