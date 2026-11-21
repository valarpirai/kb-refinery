import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { chatJson } from "@/lib/pipeline/llm";
import { renderPrompt } from "@/lib/pipeline/prompts";
import { chatAnswerSchema, judgeSchema } from "@/lib/pipeline/schemas";
import { refinedFirst } from "./blind";
import { embed } from "./embed";
import { retrieve, type Source } from "./retrieve";

export type { Source };

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
    const sources = await retrieve(arm.variant, vector, arm.comparison.query);
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
