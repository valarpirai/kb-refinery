import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { promptTemplate: { findUniqueOrThrow: vi.fn() } } }));

import { db } from "@/lib/db";
import { renderPrompt } from ".././prompts";

const find = () => vi.mocked(db.promptTemplate.findUniqueOrThrow);

describe("renderPrompt", () => {
  beforeEach(() => {
    find().mockReset();
  });

  it("loads the template by name", async () => {
    find().mockResolvedValue({ template: "hi" } as never);
    await renderPrompt("kb_article_analysis", {});
    expect(find()).toHaveBeenCalledWith({ where: { name: "kb_article_analysis" } });
  });

  it("fills placeholders, including repeats and inner spaces", async () => {
    find().mockResolvedValue({ template: "{{title}} / {{ title }} / {{content}}" } as never);
    expect(await renderPrompt("t", { title: "T", content: "C" })).toBe("T / T / C");
  });

  it("blanks unknown placeholders", async () => {
    find().mockResolvedValue({ template: "a{{missing}}b" } as never);
    expect(await renderPrompt("t", {})).toBe("ab");
  });

  it("matches placeholders case-insensitively on the token but looks up the key as written", async () => {
    find().mockResolvedValue({ template: "{{Title}}" } as never);
    expect(await renderPrompt("t", { title: "x" })).toBe("");
    expect(await renderPrompt("t", { Title: "x" })).toBe("x");
  });

  it("does not re-expand placeholders inside substituted values", async () => {
    find().mockResolvedValue({ template: "{{a}}" } as never);
    expect(await renderPrompt("t", { a: "{{b}}", b: "no" })).toBe("{{b}}");
  });

  it("keeps dollar sequences in values literal", async () => {
    find().mockResolvedValue({ template: "{{a}}" } as never);
    expect(await renderPrompt("t", { a: "$& $1" })).toBe("$& $1");
  });

  it("propagates a missing template error", async () => {
    find().mockRejectedValue(new Error("not found"));
    await expect(renderPrompt("nope", {})).rejects.toThrow("not found");
  });
});
