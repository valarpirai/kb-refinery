import { describe, expect, it } from "vitest";
import { chunkArticle } from "./chunker";

const para = (n: number, ch = "x") => ch.repeat(n);

describe("chunkArticle", () => {
  it("falls back to a single title chunk for empty text", () => {
    expect(chunkArticle("Title", "")).toEqual([{ heading: null, content: "Title" }]);
    expect(chunkArticle("Title", "   \n ")).toEqual([{ heading: null, content: "Title" }]);
  });

  it("uses the title for text without headings", () => {
    const out = chunkArticle("My Title", "Hello world");
    expect(out).toEqual([{ heading: null, content: "My Title\n\nHello world" }]);
  });

  it("splits at Markdown headings and repeats the heading in the content", () => {
    const a = para(250, "a");
    const b = para(250, "b");
    const out = chunkArticle("T", `# One\n${a}\n## Two\n${b}`);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ heading: "One", content: `One\n\n${a}` });
    expect(out[1]).toEqual({ heading: "Two", content: `Two\n\n${b}` });
  });

  it("splits at HTML headings and strips inner tags", () => {
    const a = para(250, "a");
    const out = chunkArticle("T", `<h2 class="x">Hello <b>World</b></h2>\n${a}`);
    expect(out).toEqual([{ heading: "Hello World", content: `Hello World\n\n${a}` }]);
  });

  it("keeps text before the first heading under the title", () => {
    const intro = para(250, "i");
    const out = chunkArticle("Title", `${intro}\n# H\n${para(250, "b")}`);
    expect(out[0].heading).toBeNull();
    expect(out[0].content.startsWith("Title\n\n")).toBe(true);
  });

  it("skips headings with no body", () => {
    const out = chunkArticle("T", `# Empty\n# Full\n${para(250)}`);
    expect(out.map((c) => c.heading)).toEqual(["Full"]);
  });

  it("splits a long section by size at paragraph breaks", () => {
    const paras = Array.from({ length: 4 }, (_, i) => para(500, String(i)));
    const out = chunkArticle("T", `# H\n${paras.join("\n\n")}`);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.heading).toBe("H");
    // No paragraph is cut.
    expect(out.map((c) => c.content).join("")).toContain(paras[0]);
  });

  it("does not cut a single paragraph longer than the limit", () => {
    const long = para(3000);
    const out = chunkArticle("T", `# H\n${long}`);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe(`H\n\n${long}`);
  });

  it("merges a tiny chunk into the previous one", () => {
    const out = chunkArticle("T", `# A\n${para(300, "a")}\n# B\nshort`);
    expect(out).toHaveLength(1);
    expect(out[0].heading).toBe("A");
    expect(out[0].content).toContain("B\n\nshort");
  });

  it("does not merge when the result would be too large", () => {
    const out = chunkArticle("T", `# A\n${para(1790, "a")}\n# B\nshort`);
    expect(out).toHaveLength(2);
  });
});
