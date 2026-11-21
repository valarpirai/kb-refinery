> **Source of truth is the seeded data, not this file.** This prompt is deployed as the
> `article_synthesis` row of `x_snc_kb_refinery_prompt_template`, authored in
> `src/fluent/data/record/x_snc_kb_refinery_prompt_template_article_synthesis.now.ts`, and
> rendered at runtime via `RefineryPromptTemplate.render('article_synthesis', {...})`. This file
> is a human-readable mirror kept in sync by hand.

# AI-Ready Article Synthesis (Call 3)

New prompt — not part of the original 2-call design. Added because Call 2 (Incident Enrichment)
deliberately stays structured (`ai_ready_knowledge`/`recommendations`) and never produces a full
rewritten article, but `x_snc_kb_refinery_snapshot(type='enriched').content` needs one for the
before/after demo. See `docs/plan.md`'s "Call 3: Article Synthesis" section.

**Rewrite-only as of 2026-09-02** — see "Key decisions" below for why this call no longer scores
its own output.

You are a knowledge management editor. This pipeline exists to prepare knowledge base articles to be consumed reliably by AI systems, not only by human readers — specifically an **AI agent** that must execute this article's steps autonomously with no human available to fill in gaps, and a **RAG / semantic search system** that must retrieve this article as context and have it be immediately useful on its own.

Rewrite the following KB article into an AI-ready version, incorporating the structured knowledge extracted from resolved incidents. Produce a complete, standalone replacement article — not a diff or a list of changes.

## Original Article (Markdown)

{{original_content}}

## Quality Findings on the Original Article

{{findings}}

## AI-Ready Knowledge Extracted from Incidents

{{ai_ready_knowledge}}

## Recommended Updates

- {{recommendations}}

## Instructions

1. Rewrite the article to address the findings above, incorporating the extracted conditions/actions/escalation criteria/prerequisites as real prose and structured steps (not a separate appended section listing raw JSON).
2. Preserve everything in the original article that was already correct and complete.
3. Keep the same overall topic and title — this replaces the article's body, not its subject.
4. Use clear headings, numbered steps for procedures, and explicit prerequisites — write it the way an AI agent needs it to be able to execute the steps unattended, with no guessing or inferring intent.
5. Write for retrieval, not just reading: keep each section self-contained enough to be useful if a RAG/semantic search system retrieves it on its own, without depending on surrounding sections or a different article to make sense. Use the terminology someone would actually search for, not just internal jargon.
6. Do not score the article yourself — a separate pass handles that against the same rubric used elsewhere in this pipeline.

## Output Format

Respond in JSON only, no surrounding text:

```json
{
  "enriched_content": "<the full rewritten article, in markdown>",
  "summary": "<one sentence describing what changed and why>"
}
```

## Key decisions

- **Deliberately does not re-receive raw incident text** — only Call 2's already-distilled
  `ai_ready_knowledge`/`recommendations`. Keeps incident content (potential PII, see
  `docs/security.md`) flowing into exactly one prompt, not two.
- **No longer self-scores (2026-09-02).** This call used to also produce `quality_score`,
  instructed via a one-line paraphrase of Call 1's rubric ("completeness, actionability,
  structure, currency, AI-readiness") evaluated inside the same completion as the rewrite task
  itself. That made `enriched.llm_score` not genuinely comparable to `raw`/`converted`'s scores,
  which come from the real `kb_article_analysis` prompt run in isolation. Scoring is now a
  separate, later call instead: `RefineryOrchestrator`'s `scoring_enriched` phase dispatches the
  literal `kb_article_analysis` prompt against this call's `enriched_content` (discarding
  everything but `quality_score` from that response, the same way the `raw` invocation does) —
  see `docs/prompts/KB Article Analysis.md` and `docs/plan.md`'s "LLM Calls" section.
- `score` (mechanical, `AIReadabilityScorer`) is still computed independently by
  `RefineryOrchestrator` from `enriched_content` at write time, same as always — unaffected by the
  above; only `llm_score`'s source changed.
