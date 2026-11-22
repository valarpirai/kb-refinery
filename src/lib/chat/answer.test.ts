import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { comparisonArm: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("@/lib/pipeline/llm", () => ({ chatJson: vi.fn() }));
vi.mock("@/lib/pipeline/prompts", () => ({ renderPrompt: vi.fn(async () => "PROMPT") }));
vi.mock("./embed", () => ({ embed: vi.fn(async () => [[0.1]]) }));
vi.mock("./retrieve", () => ({ retrieve: vi.fn() }));

import { db } from "@/lib/db";
import { chatJson } from "@/lib/pipeline/llm";
import { renderPrompt } from "@/lib/pipeline/prompts";
import { refinedFirst } from "./blind";
import { embed } from "./embed";
import { retrieve } from "./retrieve";
import { answerArm, judgeComparison } from "./answer";

const arm = { id: "arm1", variant: "refined", comparison: { query: "How?" } };
const src = { n: 1, articleId: "a", analysisId: null, title: "Doc", heading: null, score: 0.9, excerpt: "text" };
const update = () => vi.mocked(db.comparisonArm.update);

describe("answerArm", () => {
  it("does nothing when the arm is missing", async () => {
    vi.mocked(db.comparisonArm.findUnique).mockResolvedValue(null);
    await answerArm("x");
    expect(update()).not.toHaveBeenCalled();
  });

  it("records a completed answer with sources", async () => {
    vi.mocked(db.comparisonArm.findUnique).mockResolvedValue(arm as never);
    vi.mocked(retrieve).mockResolvedValue([src]);
    vi.mocked(chatJson).mockResolvedValue({ data: { answer: "Do this [1]" } } as never);
    await answerArm("arm1");
    expect(embed).toHaveBeenCalledWith(["How?"], "query");
    expect(retrieve).toHaveBeenCalledWith("refined", [0.1], "How?");
    expect(vi.mocked(renderPrompt).mock.calls[0][1]).toEqual({ question: "How?", excerpts: '[1] From "Doc":\ntext' });
    expect(update().mock.calls[0][0].data).toEqual({ status: "running", error: null });
    const done = update().mock.calls[1][0].data as Record<string, unknown>;
    expect(done).toMatchObject({ status: "completed", answer: "Do this [1]", sources: [src] });
    expect(typeof done.latencyMs).toBe("number");
  });

  it("tells the model when no excerpts were found", async () => {
    vi.mocked(db.comparisonArm.findUnique).mockResolvedValue(arm as never);
    vi.mocked(retrieve).mockResolvedValue([]);
    vi.mocked(chatJson).mockResolvedValue({ data: { answer: "none" } } as never);
    await answerArm("arm1");
    expect(vi.mocked(renderPrompt).mock.calls[0][1]).toMatchObject({ excerpts: "(no excerpts found)" });
  });

  it("records a failure with a truncated message instead of throwing", async () => {
    vi.mocked(db.comparisonArm.findUnique).mockResolvedValue(arm as never);
    vi.mocked(embed).mockRejectedValueOnce(new Error("x".repeat(900)));
    await expect(answerArm("arm1")).resolves.toBeUndefined();
    const failed = update().mock.calls[1][0].data as { status: string; error: string };
    expect(failed.status).toBe("failed");
    expect(failed.error).toHaveLength(500);
  });
});

describe("judgeComparison", () => {
  const original = { id: "o", variant: "original", answer: "orig", sources: [src], comparison: { query: "Q" } };
  const refined = { id: "r", variant: "refined", answer: "ref", sources: null, comparison: { query: "Q" } };
  const verdict = {
    data: {
      answer_x: { score: 3, reasoning: "Answer X is fine; Answer Y is worse" },
      answer_y: { score: 4, reasoning: "Answer Y is better than Answer X" },
    },
  };

  it("does nothing when an arm has no answer", async () => {
    vi.mocked(db.comparisonArm.findMany).mockResolvedValue([original, { ...refined, answer: null }] as never);
    await judgeComparison("cmp");
    expect(chatJson).not.toHaveBeenCalled();
    expect(update()).not.toHaveBeenCalled();
  });

  it("does nothing when an arm is missing", async () => {
    vi.mocked(db.comparisonArm.findMany).mockResolvedValue([original] as never);
    await judgeComparison("cmp");
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("orders answers by the blind rule and rewrites X and Y wording", async () => {
    vi.mocked(db.comparisonArm.findMany).mockResolvedValue([original, refined] as never);
    vi.mocked(chatJson).mockResolvedValue(verdict as never);
    const id = "cmp-1";
    await judgeComparison(id);
    const [x, y] = refinedFirst(id) ? ["r", "o"] : ["o", "r"];
    expect(update().mock.calls[0][0].where).toEqual({ id: x });
    expect(update().mock.calls[1][0].where).toEqual({ id: y });
    expect(update().mock.calls[0][0].data).toEqual({ judge: { score: 3, reasoning: "This answer is fine; The other answer is worse" } });
    expect(update().mock.calls[1][0].data).toEqual({ judge: { score: 4, reasoning: "This answer is better than The other answer" } });
    expect(chatJson).toHaveBeenCalledWith("PROMPT", expect.anything(), { think: true });
  });

  it("passes empty excerpts for an arm with no sources", async () => {
    vi.mocked(db.comparisonArm.findMany).mockResolvedValue([original, refined] as never);
    vi.mocked(chatJson).mockResolvedValue(verdict as never);
    await judgeComparison("cmp-1");
    const vars = vi.mocked(renderPrompt).mock.calls[0][1] as Record<string, string>;
    const all = [vars.excerpts_x, vars.excerpts_y];
    expect(all).toContain("(no excerpts found)");
    expect(all).toContain('[1] From "Doc":\ntext');
  });
});
