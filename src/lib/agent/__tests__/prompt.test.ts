import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from ".././prompt";

const base = { role: "  You help.  ", rules: [], tools: [], toolNotes: {} };

describe("buildSystemPrompt", () => {
  it("says there are no tools when none are enabled", () => {
    const p = buildSystemPrompt(base);
    expect(p).toBe("You help.\n\nYou have no tools. Answer from the conversation only, and say so when you cannot look something up.");
  });

  it("lists only enabled tools with their summaries", () => {
    const p = buildSystemPrompt({ ...base, tools: ["get_stats", "search_articles"] });
    expect(p).toContain("You can use these tools:");
    expect(p).toContain("- get_stats:");
    expect(p).toContain("- search_articles:");
    expect(p).not.toContain("import_from_url");
    expect(p).not.toContain("You have no tools");
  });

  it("ignores unknown tool names", () => {
    const p = buildSystemPrompt({ ...base, tools: ["nope"] });
    expect(p).toContain("You have no tools");
  });

  it("includes notes only for enabled tools and skips blank notes", () => {
    const p = buildSystemPrompt({
      ...base,
      tools: ["get_stats", "search_articles"],
      toolNotes: { get_stats: "  Use for numbers.  ", search_articles: "   ", import_from_url: "Hidden" },
    });
    expect(p).toContain("How to use them:\n- get_stats: Use for numbers.");
    expect(p.split("How to use them:")[1]).not.toContain("search_articles");
    expect(p).not.toContain("Hidden");
  });

  it("omits the guidance section when there are no notes", () => {
    expect(buildSystemPrompt({ ...base, tools: ["get_stats"] })).not.toContain("How to use them");
  });

  it("tolerates toolNotes that are not an object", () => {
    for (const toolNotes of [null, "text", 5, undefined]) {
      expect(() => buildSystemPrompt({ ...base, tools: ["get_stats"], toolNotes })).not.toThrow();
    }
  });

  it("ignores non-string note values", () => {
    const p = buildSystemPrompt({ ...base, tools: ["get_stats"], toolNotes: { get_stats: 42 } });
    expect(p).not.toContain("How to use them");
  });

  it("trims rules and drops blank ones", () => {
    const p = buildSystemPrompt({ ...base, rules: ["  Be brief. ", "", "   ", "Cite."] });
    expect(p.endsWith("Rules:\n- Be brief.\n- Cite.")).toBe(true);
  });

  it("omits the rules section when all rules are blank", () => {
    expect(buildSystemPrompt({ ...base, rules: [" "] })).not.toContain("Rules:");
  });

  it("drops an empty role", () => {
    const p = buildSystemPrompt({ ...base, role: "   " });
    expect(p.startsWith("You have no tools")).toBe(true);
  });
});
