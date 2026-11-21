# Chat comparison

This is what the chat page does and how to read its results.

## The idea

Ask one question. The app answers it twice: once from the original docs, once from the refined docs. You compare the two answers. If refining helped, the refined answer should be more correct and easier to act on.

Both answers use the same model, the same prompt, the same search and the same number of excerpts. Only the content differs.

## What "original" and "refined" mean

| Side | Text used |
|---|---|
| Original | The article as imported (`raw` snapshot) |
| Refined | The rewritten article (`enriched` snapshot). If the pipeline found nothing to rewrite, the converted Markdown. |

Only articles that finished the pipeline are searched. Both sides cover the same articles.

## How an answer is made

1. **Index.** Each article is cut into chunks at its headings, then by size. Each chunk starts with its heading. Both variants use the same chunker.
2. **Embed.** Each chunk becomes a vector with `nomic-embed-text`. Vectors live in the `Chunk` table, in a pgvector column.
3. **Retrieve.** Your question becomes a vector. The five closest chunks of that variant are the excerpts.
4. **Answer.** The model answers from the excerpts only. It cites them as `[1]`, `[2]`. If the excerpts lack the answer, it says so.

Indexing runs after each article finishes the pipeline. **Rebuild index** on the chat page re-does all of it.

## Using the page

1. Type a question. Choose **Ask both**.
2. Read the two answers. Open **Sources used** to see which chunks fed each one.
3. Choose a verdict: which is better, about the same, or neither.
4. Optional: **Auto-judge** asks the local model to score both answers from 1 to 5.

### Blind mode

On by default. The answers show as A and B in a mixed order. The order is fixed per question but not always the same side. Pick a verdict first. Then the page tells you which was original. This stops you favoring the side you expect to win.

### Auto-judge

The judge sees the question, both answers and each answer's excerpts. It does not know which is original. It scores whether the answer is on point, supported by its excerpts, complete, and honest about gaps.

A 4B model is a weak judge. Use its score as a hint. Your own verdict is the real result.

## Reading the results

The panel under the chat shows verdict totals and the average auto-judge score per side. A few dozen questions give a rough picture. Ask questions your users really ask, including ones an article only half answers.

## Limits

- **Seed data proves nothing.** The demo articles have placeholder rewrites. Refine real articles first.
- **One variable only.** Chunking and search are identical on purpose. A big gap can also come from where the chunk boundaries fall.
- **Small corpus.** With few articles, retrieval returns weak matches on both sides. Both answers may say "not found".
- **No history of the index.** Re-indexing replaces chunks with the latest run. You cannot ask against an older version.
- **First answer is slow.** The model loads on first use.

## Where the code is

| File | Job |
|---|---|
| `src/lib/chat/chunker.ts` | Cuts text into chunks |
| `src/lib/chat/indexer.ts` | Builds chunks and vectors |
| `src/lib/chat/answer.ts` | Retrieval, answering, judging |
| `src/app/api/compare/` | Ask, poll, save verdict, judge |
| `src/components/chat-compare.tsx` | The side-by-side view |
| `prisma/seed/prompts/chat_*.md` | The answer and judge prompts |
