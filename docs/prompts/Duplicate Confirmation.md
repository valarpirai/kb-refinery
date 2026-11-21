> **Source of truth is the seeded data, not this file.** This prompt is deployed as the
> `duplicate_confirmation` row of `x_snc_kb_refinery_prompt_template`, authored in
> `src/fluent/data/record/x_snc_kb_refinery_prompt_template_duplicate_confirmation.now.ts`, and
> rendered at runtime via `RefineryPromptTemplate.render('duplicate_confirmation', {...})`. This
> file is a human-readable mirror kept in sync by hand.

# Duplicate Article Confirmation

`docs/plan.md`'s "Duplicate Detection" section described this LLM confirmation call narratively
from the start, but there was no actual prompt file for it until now — this fills that gap. Called
by `RefineryOrchestrator._phaseC_deduplicating` for each candidate pair whose search-term overlap
already exceeds the 60% pre-filter threshold.

You are a knowledge management analyst. Two KB articles in the same knowledge base were flagged as possible duplicates based on overlapping search terms. Determine whether they actually cover the same topic, and if so, which one is more complete.

## Article A

- **Summary:** {{summary_a}}
- **Search Terms:** {{terms_a}}

## Article B

- **Summary:** {{summary_b}}
- **Search Terms:** {{terms_b}}

## Instructions

1. Decide whether these two articles genuinely cover the same underlying topic/problem, not just overlapping keywords.
2. If they do, decide which one appears more complete or up to date, based only on the summaries above.

## Output Format

Respond in JSON only, no surrounding text:

```json
{
  "same_topic": <true|false>,
  "more_complete_article": "<a|b>",
  "reasoning": "<one sentence explanation>"
}
```

## Key decisions

- Only receives `standardized_summary` + `search_terms` for each article, not full content — the
  pre-filter (search-term overlap) plus these two summaries is meant to be enough for a
  same-topic judgment without re-sending both full articles.
- On `same_topic: true`, the orchestrator creates one `duplicate`-type Finding on **each** article,
  cross-referencing the other via `related_article`, with `recommended_primary` on both pointing
  at whichever this call named `more_complete_article`.
