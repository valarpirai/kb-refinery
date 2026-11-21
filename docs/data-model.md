# Data model

This is what each table holds. The schema is `prisma/schema.prisma`. That file wins if this doc is out of date.

## How the tables relate

```
DataSource ──< ImportRun ──< Article ──1:1── Analysis ──< Snapshot
                  └────────< Incident          │  ├──< Finding ──< Evidence >── Incident
                                               │  └──< Mention >── Product
Job ──< JobItem >── Article
```

## Ingestion tables

| Table | Holds |
|---|---|
| `DataSource` | A configured outside source: type, config, cron, last run result. Managed on the Integrations page. |
| `ImportRun` | One upload or one scheduled pull. Counts of created, updated, skipped. A list of errors. |
| `Article` | A source article. Title, body, format, knowledge base, URL, external id. |
| `Incident` | A support incident. Number, short description, resolution. Used as evidence. |

An article is unique by data source plus external id. When the data source is empty, the app checks in code, because Postgres treats nulls as different.

## Pipeline tables

| Table | Holds |
|---|---|
| `Analysis` | One per article. The current stage, summary, audience, search terms, enrichment output. |
| `Snapshot` | One content version. Type is `raw`, `converted` or `enriched`. Never overwritten. |
| `Finding` | A problem found in an article. Type, severity, detail, state. |
| `Evidence` | Links a finding to an incident that supports it. |
| `Product` | A product name, with aliases and a count of articles that mention it. |
| `Mention` | Links an analysis to a product, with a count. |
| `Job` | One run. Coarse status and counters. |
| `JobItem` | One article inside a job. Its own status, the stage it failed in, a heartbeat, which worker holds it, and how many times it was claimed. This drives live progress. |
| `PromptTemplate` | An LLM prompt with `{{placeholder}}` slots. |
| `Chunk` | A searchable piece of an article, per variant (original or refined), with its vector. |
| `Comparison` | One chat question, with your verdict. |
| `ComparisonArm` | One side's answer, sources, time and auto-judge score. |
| `Conversation` | A saved chat. Belongs to a user. Holds comparisons and agent messages. |
| `ChatMessage` | One message with the agent. Assistant rows fill in as the agent works: text, tool calls, trace id. |
| `TraceSpan` | One OpenTelemetry span from an agent run. |
| `Notification` | A message for one user, with a read time. |
| `Tag`, `ArticleTag` | Labels on articles. Names are lowercase and unique. |
| `User`, `Session`, `Account`, `Verification` | Accounts. Owned by Better Auth. Do not rename their fields. |

## Snapshots

Each run writes three snapshots per article. They share a `version` number.

Each snapshot has two scores:

- `score`: the mechanical score. Code computes it. Same rules for every stage, so the three are comparable.
- `llmScore`: the model's own rating, from the same prompt every time.

The mechanical score is empty for content under 25 words.

## Enums that matter

| Enum | Values |
|---|---|
| `PipelineStage` | `ingested`, `analyzing`, `restructuring`, `validating`, `ready`, `failed` |
| `JobItemStatus` | `pending`, `converting`, `analyzing`, `enriching`, `scoring`, `completed`, `failed`, `skipped` |
| `JobStatus` | `pending`, `running`, `completed`, `completed_with_errors`, `failed` |
| `FindingState` | `new`, `acknowledged`, `remediated`, `cancelled` |

A new run sets old open findings to `cancelled`. History stays. Only fresh findings count.

`Chunk.embedding` is a pgvector column. Prisma cannot read or write it directly, so the indexer and the search use raw SQL.

## Not ported yet

`eval_question` from the ServiceNow app. It comes with the eval scorer.
