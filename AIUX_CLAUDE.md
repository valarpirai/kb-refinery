# AIUX Development Knowledge Base

This is a portable knowledge base for building **AIUX applications** —
ServiceNow's internal scoped-app framework built on Lit web components,
managed with the **Now SDK** (`@servicenow/sdk`) and its Fluent metadata
API, and rendered client/server-side through **karuna**
(`@servicenow/karuna`), the shared AIUX component/runtime library. It is
not itself a project — see [`README.md`](README.md) for how to adopt it
into a new one.

Everything here was extracted from real, verified findings made while
building one specific AIUX app, then generalized to strip anything
specific to that app's own business logic (its table schema, its
features, its open bugs). What's left is platform/tooling knowledge that
applies to any AIUX app: build/deploy pipeline behavior, `AIUXElement`/
`AIUXWidgetElement` lifecycle rules, router quirks, raw Glide server APIs,
and karuna component integration gotchas.

**Read [`README.md`](README.md) first** for how to bring this into a new
project, including the versions this knowledge was verified against and
why that matters before trusting any of it as-is.

## Index — `rules/`

See [`rules/README.md`](rules/README.md) for the loading convention these
files follow (a `paths:` frontmatter block makes a file load only when
matching files are touched; its absence means always-loaded).

The five files split into two layers. Both matter for an AIUX app, but
they're knowledge about different things: one layer is about the
*tooling* you build and ship with (independent of what the app actually
does), the other is about the *runtime platform* the app's own code runs
against once it's live.

### Local-dev layer — Now SDK / Fluent / build & deploy tooling

1. [`environment-build-deploy.md`](rules/environment-build-deploy.md) —
   Fluent metadata shape-checking, the Now SDK build/deploy pipeline,
   `AIUX_REPO_ROOT`/isolate-bundler externalization, the dev server's
   reverse-proxy model, minification internals, and recovery playbooks
   for the install pipeline's sharper edges.

### AIUX platform layer — widgets, pages, Glide APIs, karuna components

2. [`widget-and-page-conventions.md`](rules/widget-and-page-conventions.md) —
   Cross-cutting rules for any `AIUXElement`/`AIUXWidgetElement`: reusable-
   UI discovery, `fetchDataOnConnect`, the one-widget-class-per-file build
   rule, load-by-id race guards, and the `@config`-vs-runtime-prop
   pattern.
3. [`pages-and-router.md`](rules/pages-and-router.md) — Regular vs.
   Composed pages, the client-side router's same-path/query no-op and its
   30-second data cache, and where each one bites.
4. [`glide-platform-facts.md`](rules/glide-platform-facts.md) — Verified
   facts about the server-side Glide APIs (`GlideRecord`, `GlideQuery`,
   `GlideAggregate`) that are easy to get wrong by guessing.
5. [`karuna-component-integration.md`](rules/karuna-component-integration.md) —
   Integration gotchas for specific karuna components (condition builder,
   field pickers, dashboard-layout, date-range picker, Highcharts) found
   only by live-testing or reading their actual source.

## The one rule that produced all of the above

**Never guess a platform/library API or behavior — verify it against the
actual type definitions or source before writing it down or relying on
it.** Every fact in these files was arrived at that way, including at
least one case where a previous session guessed a `GlideRecord` method
that doesn't exist, wrote it into code, and a later session cited that
same code back as if it were proof the method was real. Existing code in
a repo is not verification — it may itself be a prior guess.
