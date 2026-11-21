> **Source of truth is the seeded data, not this file.** This prompt is deployed as the
> `kb_article_analysis` row of `x_snc_kb_refinery_prompt_template`, authored in
> `src/fluent/data/record/x_snc_kb_refinery_prompt_template_kb_article_analysis.now.ts`, and
> rendered at runtime via `RefineryPromptTemplate.render('kb_article_analysis', {...})`. This
> file is a human-readable mirror kept in sync by hand — if you edit the prompt, edit the `.now.ts`
> record and update this file to match, not the other way around.
>
> **Reused for three content versions, not one.** This exact prompt is dispatched against raw
> HTML, converted markdown, and (via the `scoring_enriched` phase) the rewritten enriched markdown
> — not three separately-worded prompts. Only `quality_score` is kept from the raw/enriched
> invocations; the rest of the response is discarded. See "Why this differs from the original doc"
> below and `docs/plan.md`'s "LLM Calls" section.

# Knowledge Article Quality Analysis

You are a knowledge management analyst. This pipeline exists to prepare knowledge base articles to be consumed reliably by AI systems, not only by human readers — specifically:

- an **AI agent** that must read this article and execute its steps autonomously, without a human available to fill in gaps or resolve ambiguity, and
- a **RAG / semantic search system** that must retrieve this article as context for a user's or agent's query, and have that retrieved content be immediately useful on its own.

Analyze the following article and produce a structured quality assessment against that standard — not against "is this readable by a person," but "is this actually usable by an AI agent acting on it, and by a retrieval system serving it as context."

## Article Metadata

- **Title:** {{title}}
- **Type:** {{articletype}}
- **Knowledge Base:** {{kbname}}
- **Last Updated:** {{lastupdated}}
- **Today's Date:** {{currentdate}}

## Article Content

(This may be the article's raw HTML exactly as authored, already-converted markdown, or a rewritten AI-ready version, depending on which pipeline stage is being scored. Read through any markup to judge the actual content and structure it conveys — don't penalize it merely for containing HTML tags.)

{{content}}

## Instructions

Analyze this article across the following dimensions:

### 1. Quality Score
Assign a score from 0-100, judged specifically against how well this article serves an AI agent and a RAG/semantic search system — not just a human reader:
- **Completeness** — does it fully address the topic in the title, with nothing a reader (human or AI) would need to look elsewhere to find?
- **Actionability** — are steps clear, specific, and followable by an AI agent executing them unattended, without guessing or inferring intent?
- **Structure** — are headings, numbered steps, and sections used effectively — including in a way that chunks cleanly for retrieval (each section self-contained enough to be useful if retrieved on its own, not dependent on surrounding sections to make sense)?
- **Currency** — is the content likely still accurate given the last updated date?
- **AI-readiness** — could an AI agent extract a deterministic action from this article with no human interpretation, and would a RAG/semantic search system retrieving this article as a chunk have enough self-contained context to answer a query correctly (the terminology a real search query would actually use, no unresolved dependency on a different article to make sense)?

### 2. Target Audience
Classify who can realistically follow this article:
- `end_user` — no elevated access or technical knowledge required
- `admin` — requires system/console access or technical expertise
- `developer` — requires code-level interaction
- `mixed` — contains steps for multiple audiences without clear separation

### 3. Standardized Summary
Write one line summarizing the article, in this consistent format so it can be scanned or fed into retrieval:
"[Action verb] [what] [for whom] [when/context]"

### 4. Findings
Identify specific quality issues. For each finding, provide:
- **type** — one of: `outdated`, `incomplete`, `image_dependent`, `no_resolution_steps`, `too_vague`, `audience_mismatch`, `missing_prerequisites`, `no_error_guidance`, `missing_context`, `unlinked_product`
- **severity** — `high`, `medium`, or `low`
- **detail** — a specific explanation of the issue

Use `missing_context` when the article references concepts, systems, or processes without explanation. Use `unlinked_product` when it mentions other products/services without linking to their KB articles or providing context.

### 5. Search Terms
Provide up to 8 search terms that end users would type in a support ticket when experiencing the problem this article addresses.

Guidelines:
- Use informal, user-facing language — not formal documentation terminology
- For troubleshooting articles, extract key terms from the issue, problem, or cause sections if present
- When a term has common abbreviations or aliases (e.g., "Office 365" / "O365", "Multi-Factor Authentication" / "MFA"), include both variations as separate terms
- Focus on the symptom the user experiences, not the underlying technical cause

### 6. Product Mentions
List the names of any distinct products, services, or platforms this article mentions (internal or external, e.g. "Okta", "Microsoft Teams"). Use the canonical product name, not an abbreviation, unless the abbreviation is how the product is universally known. Empty array if none.

## Output Format

Respond in JSON only, no surrounding text:

```json
{
  "quality_score": <number 0-100>,
  "target_audience": "<end_user|admin|developer|mixed>",
  "standardized_summary": "<one line, following the format above>",
  "findings": [
    {
      "type": "<finding_type>",
      "severity": "<high|medium|low>",
      "detail": "<explanation>"
    }
  ],
  "search_terms": ["<term1>", "<term2>", "..."],
  "product_mentions": ["<product1>", "..."],
  "summary": "<one sentence overall assessment>"
}
```

## Why this differs from the original doc

The original version of this prompt (before this pipeline pass) only asked for `quality_score`,
`target_audience`, `findings[]`, `search_terms[]`, and `summary`. Two things were missing that the
schema actually needs: `standardized_summary` (feeds `Analysis.standardized_summary`, used for
duplicate detection and the dashboards) and `product_mentions` (feeds
`x_snc_kb_refinery_mention`/`product`). The findings `type` enum was also missing
`missing_context`/`unlinked_product`, which `docs/plan.md` already documented Call 1 as detecting.
See `docs/plan.md`'s "LLM Calls" section and `.claude/rules/kb-refinery-domain.md`.

**2026-09-02**: the article-metadata framing was made explicit about *why* this analysis is being
done (AI-agent execution + RAG retrieval, not human readability), and the AI-readiness/Structure
rubric bullets were expanded to name those two consumers directly, rather than leaving "AI-ready"
as an unexplained one-line criterion. The content placeholder was also renamed from
`{{markdowncontent}}` to `{{content}}` and this prompt is now reused verbatim for raw and enriched
content too (previously converted-only) — see the banner at the top of this file.
