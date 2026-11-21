# Duplicate Article Confirmation

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

Respond with ONLY the JSON object below, wrapped in a fenced code block exactly as shown (nothing before or after the fence):

```json
{
  "same_topic": <true|false>,
  "more_complete_article": "<a|b>",
  "reasoning": "<one sentence explanation>"
}
```
