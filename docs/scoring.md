# AI-ready scoring

Every article gets a score out of 100. The score says how well the article survives being cut into chunks. AI retrieval cuts articles into chunks.

## Why score at all

Many knowledge articles were written for people. AI agents and search systems read them differently. They see one chunk at a time. They cannot ask what "it" means.

Without a number, "AI-ready" is an opinion. A rubric gives you three things:

- **A definition.** The criteria name what breaks retrieval.
- **A ranking.** Fix the worst articles first.
- **A measurement.** Score before and after. See if the rewrite helped.

## The five criteria

| Criterion | Max | What costs points |
|---|---|---|
| Self-containedness | 30 | Sections that open with "This" or "It". Phrases like "see above". Acronyms never spelled out. Vague headings like "Overview". "The tool" instead of the product name. |
| Chunk geometry | 25 | Text before the first heading. Sections too big for one chunk (about 512 tokens). |
| Cleanliness | 20 | Too much markup. Junk content. |
| Completeness in text | 15 | Images with no alt text or explanation. Tables with no headers. |
| Reference integrity | 10 | Broken links. |

## Two scores, same rubric

**Mechanical score.** Plain code. It parses the text, counts hits, applies thresholds. No LLM. Same input, same score, every time. It refuses content under 25 words.

**LLM score.** A language model reads the article. It scores the same five criteria. The total must equal the five sub-scores added up. It catches meaning that code cannot, such as whether a heading names its subject.

The mechanical score is repeatable but shallow. The LLM score is deeper but can drift. Together they check each other.

## From legacy article to AI-ready

1. **Convert.** Turn the original HTML into clean Markdown. Check every link. Broken ones become findings at once. No LLM.
2. **Analyze.** The LLM lists quality findings. It adds search terms in users' own words, a one-line summary, and the products named. Articles with no gap stop here.
3. **Enrich.** Articles with gaps get more. Find resolved support tickets on the same topic. Extract conditions, actions, escalation criteria and prerequisites. If tickets are thin, general product knowledge fills in.
4. **Rewrite.** The LLM writes a complete replacement article. An agent can run the steps with no guessing. Each section stands alone.
5. **Rescore.** Score the rewrite with the same prompt as the original.

The rewrite never sees raw ticket text. It sees only the distilled knowledge. Sensitive data stays in one place.

## Three stages, six numbers

Each run saves three snapshots. Each snapshot holds both scores.

| Stage | Content |
|---|---|
| 1. Raw | The original HTML. |
| 2. Converted | Clean Markdown. |
| 3. Enriched | Rewritten with ticket evidence. |

**Why the same prompt three times?** A different prompt gives a different number, even on the same text. A model also scores differently when the reply carries other work. So the full analysis prompt runs at all three stages. Only the quality score is kept from the raw and enriched runs. The comparison stays fair.

## Architecture

Three layers. A web UI on top. A data model in the middle. An async pipeline underneath.

| Layer | Holds |
|---|---|
| Web UI | Home, pipeline view, job tracker, and a per-article report. Pages update live. No polling. |
| Data model | Article analysis, snapshots, findings, evidence, products, mentions, jobs, job items, and prompt templates. |
| Pipeline | An orchestrator, an LLM client, a mechanical scorer, and a ticket search. |

### Data flow

A source article gets one **Analysis** row, with its current stage. Three kinds of record hang off it:

- **Snapshot.** Append-only. Raw, converted and enriched content, each with both scores.
- **Finding.** A quality issue. Linked **Evidence** points to the tickets that support it.
- **Mention.** A product named in the article. It feeds a shared product index.

A **Job** is one run. A **Job item** is one article in one run. Progress lives on the job item.

A **Prompt template** is a lookup table. Prompts are data, not code.

### How a run executes

1. A run creates one job item per article.
2. Each item moves through converting, analyzing, enriching and scoring. Items finish at different times.
3. LLM calls are async. The worker sends the item to its next stage or marks it done.
4. Every step is isolated per item. One failure never strands the others.
5. When the last item finishes, the job closes. It ends as completed, completed with errors, or failed.

### Design choices

- **Snapshots never overwrite.** Every rerun adds rows. History comes free. Rows from one run share a version number. You never mix one run's raw with another run's enriched.
- **One article, one analysis row.**
- **Coarse job status, fine item status.** The job answers "is it done." The job item answers "where is this article."

## How AI uses it

### RAG search

1. **Index.** The system cuts each article into chunks. It embeds each chunk.
2. **Retrieve.** A user asks a question. The system finds the closest chunks.
3. **Answer.** An LLM reads those chunks. It writes the reply.

The model sees one chunk at a time. It cannot see the rest of the article. A chunk that opens with "This must be enabled first" is useless alone. Nobody knows what "this" is.

### AI agents

An agent runs the steps with no human to ask. It needs prerequisites, numbered steps and clear conditions. It needs escalation criteria that say when to stop. The rewrite step writes exactly that.

### Chunk size

Headings are where a splitter cuts. Each section should be one chunk. The rubric checks this.

| Rule | Value |
|---|---|
| Token cap per section | 512 |
| Rough size in prose | About 390 words |
| Token estimate | Words × 1.3, or characters ÷ 4. The higher one wins. |
| Valid section | Has a heading and fits under the cap. |
| Chunk score | 25 × (words in valid sections ÷ all words) |

Characters ÷ 4 matters for dense text. Code, tables and IDs use more tokens than prose. A short table can break the cap.

**Example.** An article has 1,000 words. A 600-word section runs about 780 tokens. It is over the cap. The other 400 words sit under headings and fit. Coverage is 400 ÷ 1,000 = 0.4. The chunk score is 25 × 0.4 = 10 out of 25. Split the big section and the score rises.

Splitters differ. Some cut by tokens, some by headings. Headed, right-sized sections work with all of them.

## Reading a score

| Range | Meaning |
|---|---|
| 0–25 | Not usable by AI. Rewrite first. |
| 26–50 | Weak. Many chunks lose their meaning alone. |
| 51–75 | Workable. Targeted fixes help. |
| 76–100 | AI-ready. |

These are reporting buckets, not a pass mark. No cut-off for "good enough" is set yet.

## What else the analysis finds

Scores are one output. The analysis also raises findings, each with a severity and a quote from the article.

- **duplicate.** Two articles cover the same ground.
- **broken_link.** A link fails to resolve.
- **audience_mismatch.** Steps need more access than the stated audience has.
- **image_dependent.** The meaning lives in images, not text.
- **missing_context.** A step assumes knowledge the article never gives.
- **unlinked_product.** A product is named but not linked or explained.

Duplicate checks run in the background and never delay an article. An article unchanged since its last successful run is skipped.

## Current limits

- **No measured results yet.** No full run on real data has been confirmed.
- **The rubric is not proven.** Nothing yet shows that a higher score means better retrieval.
- **LLM score drift.** Repeat runs on one article may differ. Variance is untested.
- **Rewrites are not published.** They are stored as snapshots. No step pushes them back to the source article.

### How to prove it

A table of real user queries already exists. Each query lists the articles cited. Each notes whether the user found the answer helpful. A side tool counts how many of a query's words appear in its article. It is a rough check. Someone runs it by hand. It is not tied to this rubric.

Next step: score those cited articles. Compare the scores with the feedback. If high scores track helpful answers, the rubric works.

### The payoff

A clear before-and-after story: "Conversion lifted it from 38 to 55. Enrichment lifted it to 82." Those numbers are illustrative. Measure your own corpus before quoting results.
