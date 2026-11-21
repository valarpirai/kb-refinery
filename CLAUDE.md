## This app's own notes

- [`.claude/rules/kb-refinery-domain.md`](.claude/rules/kb-refinery-domain.md)
  — app-specific findings (this app's own schema/business-logic/tooling-
  config gotchas), as opposed to the generic platform knowledge in
  `AIUX_CLAUDE.md`'s copied `rules/` files below. Add new app-specific
  findings here, not to the copied files.

## AIUX_CLAUDE.md
- `AIUX_CLAUDE.md` and the `.claude/rules/{environment-build-deploy,
  widget-and-page-conventions,pages-and-router,glide-platform-facts,
  karuna-component-integration}.md` files it indexes are a **copy of a
  shared, portable template** (from the `aiux_claude` source repo) —
  generic AIUX/Now-SDK/Fluent/karuna platform knowledge, not this
  project's own notes.
- **Don't add this app's own findings to those files.** A fact about
  this app's own schema, business logic, or known issues belongs in
  this project's own `CLAUDE.md` and its own `.claude/rules/<this-
  app>-domain.md` file (create one if it doesn't exist) — not in the
  copied files above.
- **Exception**: a fact you've verified is genuinely generic — true
  for *any* AIUX app, not just this one (a platform/tooling behavior,
  a karuna component's actual source-level behavior) — can go into the
  relevant copied file directly, following its existing structure and
  verification standard. Even then, tell the user it's worth
  upstreaming into the source `aiux_claude` template repo: this is a
  local copy that won't sync back on its own, and a good finding made
  here is easy to lose track of otherwise.
