# `.claude/rules/` — reference doc conventions

This directory holds reference material split out of a project's root
`CLAUDE.md` so it doesn't have to load into every session's context in
full. A plain `@path` import from `CLAUDE.md` does **not** achieve that —
imported files still load in full every session, identical to inlining
them. Real conditional loading requires a file to live directly under
`.claude/rules/` with `paths:` frontmatter.

## `paths:` frontmatter — what makes a file conditional

A file in this directory loads **unconditionally, every session** unless
it has YAML frontmatter with a `paths:` list of globs, in which case it
loads **only when Claude actually works with a file matching one of those
globs** during the session. Use this for large, self-contained sections
that map cleanly onto their own directories (a specific widget family, a
specific feature area) — keep cross-cutting or safety-critical content
(deploy pipeline gotchas, base-class lifecycle rules, anything that isn't
reliably tied to editing one specific file) unconditional instead.

If you add a new always-loaded file, don't add `paths:` frontmatter at
all — its presence (even an empty list) is what makes a file conditional.

Each rules file should carry its own `## Known issues` section at the
bottom for open (or resolved-but-worth-remembering) findings specific to
that subsystem — append there rather than creating a separate tracker
file, so the issue only costs tokens in sessions where the related file is
actually relevant.

## Known unknowns about this mechanism

Claude Code's own docs don't currently state (as of this writing):

- Whether a triggered rule stays "on" for the rest of that session once a
  matching file is touched, or only for that turn.
- Whether subagents (Explore/Plan/general-purpose, etc.) see path-scoped
  rules at all, or only the main session does.

Both are worth spot-checking occasionally rather than assumed.

## Deferred: a human-facing mirror

Consider whether this content is also worth mirroring under a separate,
non-dotfile directory (with its own `CLAUDE.md` + `rules/` folder) so it's
browsable without digging into a hidden directory. If you do this, decide
up front whether it's a second source of truth to keep in sync by hand, or
whether `.claude/rules/*.md` files become thin stubs (frontmatter + an
`@import`) pointing at the real content living in the mirror — don't let
it silently become two diverging copies of the same prose.
