# EmployeeWorks chat mockup

A small, standalone chat feature: a landing search box and a multi-turn
chat thread, styled after the ServiceNow homepage search box → Now Assist
chat flow. **Unrelated to the Knowledge Refinery pipeline** described in
`plan.md`/`architecture.md` — no `Analysis`/`Snapshot`/`Job` involvement,
no AI Agent Studio (`AiAgent()`/`sn_aia_agent`) involvement. It reuses two
pieces of existing pipeline infrastructure (the "Knowledge Refinery" Now
Assist Skill, via a new sync entry point; the app's shell/nav) but is
otherwise a separate slice of the app.

## Pages and widgets

**Single page, not two.** The feature originally had a separate landing
page (`pages/ask`) and a separate chat-thread page (`pages/chat`), with
the launcher `navigate()`-ing between them. `pages/chat` **404'd on the
deployed instance** ("page not found," a genuine server-side route-
resolution failure) despite its `sys_aix_page`/`sys_aix_widget`/
`sys_aix_experience_page_rel` records all looking structurally identical
to `pages/ask`'s own (confirmed by diffing the generated XML) and
existing on the instance — see `.claude/rules/kb-refinery-widgets.md`
for the full diagnostic trail. Root cause not fully pinned down; what
*is* confirmed is that mounting `<chat-thread>` directly, on the one page
that already worked, worked immediately with no other changes. Given
that, the page-navigation approach was dropped rather than chased
further.

| Path | Purpose |
| --- | --- |
| `pages/ask` | The only page. Greeting + `<chat-launcher>` first; once it dispatches `chat-launcher:submit`, this page swaps to rendering `<chat-thread .initialQuestion=...>` in place — same route, no navigation. |
| `pages/chat` | **Orphaned** — no longer linked from anywhere (kept on disk, not deleted, pending a decision on whether to remove it; see below). |
| `widgets/chat-launcher` | Textarea + send button, no `server.js`. Dispatches `chat-launcher:submit` (`detail: {question}}`) instead of navigating — same event-based handoff `pipeline-run-launcher` uses (`pipeline-run-launcher:started`, see `pages/home/page.js`). |
| `widgets/chat-thread` | The actual conversation: message list, markdown rendering, "Thinking…" state, follow-up input box, `server.js` with the `ask` action. |

Nav entry: "EmployeeWorks" → `/ask`, in `application.js`.

**`pages/chat/` is dead code, not deleted.** Deleting an AIUX page directory
produces real `DELETE` records, but into the *elective* update bucket
(`author_elective_update/`) that an ordinary deploy doesn't apply — see
`environment-build-deploy.md`'s "Known issues" section. Removing the
directory wouldn't retract the already-installed page/rel records on the
instance without that extra step, so it was left in place rather than
half-cleaned-up. Delete it (and its now-installed instance records) as a
deliberate follow-up, not a side effect of this change.

## Backend: what's real, what's a placeholder

`widgets/chat-thread/server.js`'s `ask` action does two things per turn:

1. **RAG search — real, with two of its three sources still placeholders.**
   `RefineryAssistantRag.search(query, limit, kbSource)`
   (`src/fluent/script-includes/refineryAssistantRag.*`) now calls the real
   `sn_search.RAGRetrievalAPI` (the original plain `kb_knowledge` `LIKE`
   query on `short_description`/`text` is gone). `kbSource` selects an
   entry from `RefineryAssistantRag.KB_SOURCES`:
   - `generic` — real, wired to `quick_action_kb_search_profile` (sys_id
     `0d6e994dc30101103f4fcd7b7940ddf6`), the same AI Search profile
     `src/fluent/agents/kb_search_demo_agent.now.ts` uses for its RAG
     Search tool.
   - `converted` / `enriched` — **placeholders**: no search profile/source
     exists yet over this app's own `x_snc_kb_refinery_snapshot` content of
     those types, so `search()` falls back to `generic` for either one.
     Wire a real `searchProfile` (and, if needed, a `sources`/
     `semanticConfiguration` override) into that registry entry once one
     exists — no other file needs to change.

   `pages/ask/page.js` renders a `<select>` ("Knowledge source") above the
   launcher/thread swap area, holding `_kbSource` (default `generic`) and
   passing it straight through as `<chat-thread .kbSource=...>` →
   `server.get({..., kbSource})` → `RefineryAssistantRag.search`. The
   client-side `KB_SOURCE_OPTIONS` labels in that page are a manually-kept-
   in-sync mirror of the server's `KB_SOURCES` labels, not fetched from the
   server.

   The call signature grew a third argument and the return shape
   (`{title, snippet, number, sysId}[]`) is unchanged — the snippet is
   still the same crude window-around-first-match text built from the
   matched `kb_knowledge` record's own `text` field, not a matched-passage
   field off the RAG response itself (that response shape isn't covered by
   this project's generated type defs — see `RefineryAssistantRag.search`'s
   own doc comment).

2. **LLM call — real, not a placeholder.** `RefineryLLM.dispatchSync(item)`
   (new function, added to the existing `refineryLLM.server.js` alongside
   `dispatchBatch`) makes a genuine `sn_one_extend.OneExtendUtil.execute()`
   call in `mode: 'sync'` against the same real, already-deployed
   "Knowledge Refinery" Now Assist Skill (Claude via Bedrock) that
   `RefineryOrchestrator`'s pipeline phases use — just synchronous instead
   of `dispatchBatch`'s async + `RefineryLLMCallback` round trip, so a chat
   turn can return a reply within the same script execution instead of a
   later callback.

   One turn = one `promptText` string built in `server.js`'s `_buildPrompt`
   — system instructions + the last `MAX_HISTORY_TURNS` turns of
   conversation + the RAG snippets + the new question. Deliberately **not**
   `dispatchBatch`'s `chatHistory`/`__chat_history` payload shape: that
   shape is confirmed to work for the *async* path (see
   `.claude/rules/kb-refinery-domain.md`'s "RefineryLLM.dispatchBatch also
   accepts a chat-history payload shape" note) but has no real caller and
   no confirmed response shape for a *sync* call — a single self-contained
   prompt string reuses this app's one fully-confirmed round trip
   (`promptText` in, `result.response`/`result.message` out) instead of
   adding a second unverified variable.

   **Not yet live-verified against this specific skill.** The request
   shape (`mode: 'sync'`, plain `execute()`, no `callbackHandler`) is
   confirmed working against a *different* skill/capability in a different
   app on this same instance (see `refineryLLM.server.js`'s own doc
   comment on `dispatchSync`) — not yet tested against the "Knowledge
   Refinery" skill specifically. `RefineryLLM._extractSyncText` therefore
   tries a few plausible response envelope shapes in order (the confirmed
   sync shape first, then this app's confirmed *async* shape, then a bare
   top-level fallback) and `gs.warn`s the raw response if none match,
   rather than assuming one and failing silently. First real run against
   `surfuat2` will show which shape it actually is — likely a one-line
   simplification once known.

## Handoff from launcher to thread

`pages/ask/page.js` holds one piece of state, `_question`, seeded by
listening for `chat-launcher:submit` on the wrapper around `<chat-launcher>`.
Once set, `render()` swaps `<chat-launcher>` out for
`<chat-thread .initialQuestion=${this._question}>` — a different custom
element, so Lit tears down the old one and mounts a fresh `<chat-thread>`,
which then sends that first question itself from its own `firstUpdated()`
(see below) exactly as it did when it was reached via a `?q=` query param
under the old two-page design.

## Send flow: "Thinking…" without blocking the UI

`widgets/chat-thread/index.js#_send()`: pushes the user's message and an
assistant placeholder (`{thinking: true}`) into `_messages` immediately,
then calls `this.server.get({action: 'ask', ...})` and replaces the
placeholder by id once it resolves (or on error) — the same
"optimistic-append, replace-by-id" shape already used elsewhere in this
app's widgets for a mutation whose result arrives later. Nothing here
blocks the input box or forces the user to wait for the reply to appear
before the UI updates.

Markdown rendering reuses the exact pattern already established in
`pages/analysis-report/[sysId]/components/analysis-content-viewer.js`:
`marked` + `dompurify` dynamically `import()`ed from `firstUpdated()`
(never `connectedCallback()`/`render()`), sanitized, injected via
`unsafeHTML` — see `.claude/rules/environment-build-deploy.md` for why
this has to be a dynamic import rather than a static one.

## Deliberately out of scope for this pass

- **No persisted thread.** `server.js`'s `ask` action is stateless — the
  client's in-memory `_messages` array is the only copy of the
  conversation. A page reload loses it. Fine for a mockup; would need a
  real table (a lightweight analogue of `x_snc_kb_refinery_job`/`analysis`,
  or a purpose-built "chat session" table) if this needs to survive a
  reload or be resumable.
- **No real user identity.** The user's own messages are labeled "You" —
  no lookup of the actual logged-in user's display name.
- **No accessibility pass** beyond what falls out of existing shared
  patterns (`<aiux-loader>`'s built-in `role="status"`/`aria-live`, labeled
  textareas/buttons). Not run through `accessibility:accessibility`.
- **No live browser verification.** Confirmed via `now-sdk build` + lint
  only, same caveat `architecture.md` already carries for several other
  pieces of this app — not yet opened against a real instance in a
  browser.

## Related files

- `src/fluent/script-includes/refineryLLM.server.js` — `dispatchSync`,
  `_extractSyncText` (new); `dispatchBatch`, `parseJsonReply` (pre-existing,
  pipeline-only).
- `src/fluent/script-includes/refineryAssistantRag.now.ts` /
  `.server.js` — real `sn_search.RAGRetrievalAPI` call + `KB_SOURCES`
  registry (`generic` real, `converted`/`enriched` placeholders).
- `widgets/chat-launcher/`, `widgets/chat-thread/` — new; `chat-thread`
  also takes a `kbSource` prop, forwarded to its `server.js`.
- `pages/ask/` — new, the only page this feature actually uses; also owns
  the "Knowledge source" `<select>` (`KB_SOURCE_OPTIONS`/`_kbSource`).
- `pages/chat/` — new, currently orphaned (see above).
- `application.js` — new nav item.
- `eslint.config.mjs` — `RefineryAssistantRag` added to the
  `widgets/**/server.js` globals block; `sn_search` added to the platform
  API namespaces block.
