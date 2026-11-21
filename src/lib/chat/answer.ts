import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { chatJson } from "@/lib/pipeline/ollama";
import { renderPrompt } from "@/lib/pipeline/prompts";
import { chatAnswerSchema, judgeSchema } from "@/lib/pipeline/schemas";
import { refinedFirst } from "./blind";
import { embed, toVectorLiteral } from "./embed";

const TOP_K = 5;

/** Chunks scoring below this are treated as unrelated. Relevant hits score about 0.75 to 0.85 with nomic-embed-text. */
export const MIN_SCORE = 0.6;

export interface Source {
  n: number;
  articleId: string;
  analysisId: string | null;
  title: string;
  heading: string | null;
  score: number;
  excerpt: string;
}

/**
 * Find the chunks closest to a question within one variant.
 * @param variant original or refined
 * @param vector the question embedding
 * @param minScore drop chunks scoring below this; defaults to keeping all five
 * @return up to five sources, best first, numbered from 1
 */
export async function retrieve(variant: "original" | "refined", vector: number[], minScore = 0): Promise<Source[]> {
  const rows = await db.$queryRaw<{ articleId: string; analysisId: string | null; title: string; heading: string | null; content: string; score: number }[]>`
    SELECT c."articleId", an.id AS "analysisId", a.title, c.heading, c.content, 1 - (c.embedding <=> ${toVectorLiteral(vector)}::vector) AS score
    FROM "Chunk" c JOIN "Article" a ON a.id = c."articleId"
    LEFT JOIN "Analysis" an ON an."articleId" = a.id
    WHERE an."pipelineStage" = 'ready' AND c.variant = ${variant}::"ChunkVariant" AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${toVectorLiteral(vector)}::vector
    LIMIT ${TOP_K}`;
  return rows.filter((r) => Number(r.score) >= minScore).map((r, i) => ({ n: i + 1, articleId: r.articleId, analysisId: r.analysisId, title: r.title, heading: r.heading, score: Number(r.score), excerpt: r.content }));
}

/** Render sources the way the prompts expect them. */
function formatExcerpts(sources: Source[]): string {
  if (sources.length === 0) return "(no excerpts found)";
  return sources.map((s) => `[${s.n}] From "${s.title}":\n${s.excerpt}`).join("\n\n");
}

/**
 * Answer one arm of a comparison: retrieve from its variant, then ask the model.
 * Records the answer, sources and time. A failure is recorded on the arm, not thrown.
 * @param armId the comparison arm to answer
 */
export async function answerArm(armId: string): Promise<void> {
  const arm = await db.comparisonArm.findUnique({ where: { id: armId }, include: { comparison: true } });
  if (!arm) return;
  const started = Date.now();
  await db.comparisonArm.update({ where: { id: armId }, data: { status: "running", error: null } });
  try {
    const [vector] = await embed([arm.comparison.query], "query");
    const sources = await retrieve(arm.variant, vector);
    const prompt = await renderPrompt("chat_answer", { question: arm.comparison.query, excerpts: formatExcerpts(sources) });
    const { data } = await chatJson(prompt, chatAnswerSchema);
    await db.comparisonArm.update({
      where: { id: armId },
      data: { status: "completed", answer: data.answer, sources: sources as unknown as Prisma.InputJsonValue, latencyMs: Date.now() - started },
    });
  } catch (e) {
    await db.comparisonArm.update({
      where: { id: armId },
      data: { status: "failed", error: (e as Error).message.slice(0, 500), latencyMs: Date.now() - started },
    });
  }
}

/**
 * Score both answers of a comparison with the local model, blind to which is which.
 * The order shown to the judge is decided by the comparison id, so it is stable but not always original-first.
 * @param comparisonId the comparison to judge
 */
export async function judgeComparison(comparisonId: string): Promise<void> {
  const arms = await db.comparisonArm.findMany({ where: { comparisonId }, include: { comparison: true } });
  const original = arms.find((a) => a.variant === "original");
  const refined = arms.find((a) => a.variant === "refined");
  if (!original?.answer || !refined?.answer) return;

  const [x, y] = refinedFirst(comparisonId) ? [refined, original] : [original, refined];
  const excerpts = (a: typeof x) => formatExcerpts((a.sources as unknown as Source[]) ?? []);
  const prompt = await renderPrompt("chat_judge", {
    question: original.comparison.query,
    answer_x: x.answer!, excerpts_x: excerpts(x),
    answer_y: y.answer!, excerpts_y: excerpts(y),
  });
  const { data } = await chatJson(prompt, judgeSchema, { think: true });
  // The judge talks about "Answer X" and "Answer Y". Say "this answer" and "the other answer" instead.
  const own = (r: string, mine: "X" | "Y") =>
    r.replace(new RegExp(`Answer ${mine}\\b`, "gi"), "This answer").replace(/Answer [XY]\b/gi, "The other answer");
  await db.comparisonArm.update({ where: { id: x.id }, data: { judge: { ...data.answer_x, reasoning: own(data.answer_x.reasoning, "X") } } });
  await db.comparisonArm.update({ where: { id: y.id }, data: { judge: { ...data.answer_y, reasoning: own(data.answer_y.reasoning, "Y") } } });
}
