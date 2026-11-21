# Security

What's actually decided vs. still open. Treat this doc as a punch list, not a description of a finished security posture.

## Current state

- **One role, `x_snc_kb_refinery.user`** (`src/fluent/roles/user.now.ts`), granted `create`/`read`/`write`/`delete` on all 8 pipeline tables (7 original + `x_snc_kb_refinery_job_item`, added 2026-09-03) via 32 `Acl()` records (`src/fluent/acls/*.now.ts`, one file per table, `decisionType: 'allow'`, `adminOverrides: true`). This is a single flat role — anyone who has it gets full CRUD on every pipeline table; there's no separate read-only/admin tier yet (see "Not decided yet" below).
- **Both `create` and `write` ACLs exist on every table** — see the `GlideRecordSecure.insert()` note just below for why that matters; it would have been an easy thing to get wrong by only granting `create`.
- **`allowWebServiceAccess: true` on the tables (`tables.md`) is unrelated to these ACLs.** It only gates whether the Table API exposes the table at all; the `Acl()` records are what actually control who can read/write rows. Both need to be correct together.
- **`Table({ actions: {...} })` is still not a security control.** `actions.read` was flipped to `true` on every table (2026-09-02) so the Table API actually exposes reads — but that's purely a Table API on/off switch; real read authorization is exclusively via the `Acl()` records above, unaffected by this change. Don't reach for `actions` if a future "restrict write access" ask comes up; add/adjust an `Acl()` instead.
- **Before trusting this on a real instance:** the `ChoiceColumn` elective-update caveat in `tables.md` is about choice values, not these ACLs — `Acl`/`Role` records aren't known to have the same elective-bucket behavior, but that hasn't been specifically re-verified for this SDK version. Confirm the role and all 32 ACLs actually land after a real deploy, not just that the build produced them locally.

## Still to do before the pipeline job writes to these tables

- **Decide the job's execution identity.** Whether the pipeline runs as a scheduled script (effectively admin, bypassing ACLs entirely) or as an impersonated/lower-privileged account determines whether `x_snc_kb_refinery.user` is even the role that matters here, or whether the job needs its own service-account role instead. `adminOverrides: true` means an admin-context job doesn't need this role at all; a non-admin job does.
- **Decide who actually gets `x_snc_kb_refinery.user` assigned.** The role exists now, but no user/group assignment has been made — that's a real instance-admin action, not something Fluent can pre-decide for you.

## Data sensitivity: incident content flows into LLM prompts

The enrichment pipeline (Call 2, now a `x_snc_kb_refinery_prompt_template` row named
`incident_enrichment` rather than a standalone doc — see `tables.md`) deliberately pulls
`close_notes` from resolved incidents (via `RefineryIncidentSearch`) into an LLM prompt, and
stores the LLM's characterization of that data on `x_snc_kb_refinery_evidence.new_information`.
That's customer support ticket content — potentially containing PII, internal system details, or
other information an end user typed into a ticket without expecting it to be re-surfaced in a KB
article draft.

- Call 3 (Article Synthesis — see `plan.md`) deliberately does **not** re-receive raw incident
  text when producing the final rewritten article; it only receives Call 2's already-distilled
  `ai_ready_knowledge`/`recommendations`. This keeps incident content flowing into exactly one
  prompt, not two.
- The pipeline currently calls a Now Assist Skill via `sn_one_extend.OneExtendUtil.executeSecure`
  (`RefineryLLM.dispatchBatch`, async and batched — see
  `src/fluent/script-includes/refineryLLM.server.js` and `refineryLLMCallback.server.js`) rather
  than an external LLM endpoint — same reasoning as the `sn_generative_ai.LLMClient`
  recommendation this section used to make: keep incident content inside the platform's existing
  trust boundary. Batching means one call can carry several articles' incident data at once —
  confirm the Skill's own data handling/isolation between batched requests once it's created, not
  just its per-request handling.
- No redaction/PII-scrubbing step exists anywhere in the current plan. Worth a explicit decision (even "out of scope for the hackathon demo, revisit before any real customer data touches this") rather than an implicit assumption either way.

## `x_snc_kb_refinery_prompt_template`'s own ACL

Read-only (`src/fluent/acls/prompt_template.now.ts`, one `read` ACL, matching the table's
`actions: {read: true, update/delete/create: false}`) — mirrors the sibling `AI Group Chat` app's
identical prompt template table. No write/create/delete ACL exists on purpose; the four current
rows are seeded as build-time `Record()` fixtures, not edited live.

## Aggregate queries on the future dashboards

`pages/home` will eventually need real counts (findings by severity, articles by score band, etc.) instead of its current hardcoded arrays. When that's built: `GlideAggregate`'s `.withAcls()` can silently no-op specifically on the aggregate path — a `.withAcls().count()` can run fully unsecured with no error surfaced anywhere (see `.claude/rules/glide-platform-facts.md`). Don't assume calling `withAcls()` on an aggregate means the count is actually ACL-filtered; verify the specific method chain before trusting a dashboard number as access-scoped.

## Rendering article content in the UI

`article-diff-dialog.js` currently renders only hardcoded plain-text demo strings — no unsafe-HTML rendering exists today. Once it's wired to real `x_snc_kb_refinery_snapshot.content` (original article HTML, or converted Markdown rendered to HTML for the diff view), that content is either the KB author's own HTML or LLM output — render it through Lit's normal auto-escaping template bindings, never `innerHTML`/`unsafeHTML`, unless it's been through a sanitizer first. If a Markdown-to-HTML render is needed client-side, `marked` + `dompurify` dynamically imported from `firstUpdated()` (never a static top-level import, never from `render()`/`connectedCallback()`) is the pattern already established for this kind of browser-only, SSR-unsafe library in this stack — see `.claude/rules/glide-platform-facts.md`'s dynamic-import note.

## Not decided yet

- Whether one flat `user` role (full CRUD everywhere) is the right long-term shape, or whether this should split into tiers (e.g. a read-only role for browsing findings/dashboards vs. a role that can actually write pipeline output) once there's a real admin UI to protect.
- Retention/deletion policy for `x_snc_kb_refinery_evidence` if it ever contains PII pulled from incident notes.
