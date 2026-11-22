import { describe, expect, it } from "vitest";
import {
  analysisSchema, chatAnswerSchema, CONTENT_GAP_TYPES, duplicateSchema, enrichmentSchema,
  judgeSchema, scoreOnlySchema, synthesisSchema,
} from ".././schemas";

describe("analysisSchema", () => {
  const minimal = { quality_score: 70 };

  it("fills defaults for a minimal reply", () => {
    const r = analysisSchema.parse(minimal);
    expect(r).toEqual({
      quality_score: 70, target_audience: "mixed", standardized_summary: "", findings: [],
      search_terms: [], product_mentions: [], summary: "",
    });
  });

  it("turns null strings and lists into empty values", () => {
    const r = analysisSchema.parse({ ...minimal, standardized_summary: null, summary: null, search_terms: null, product_mentions: null });
    expect(r.standardized_summary).toBe("");
    expect(r.summary).toBe("");
    expect(r.search_terms).toEqual([]);
    expect(r.product_mentions).toEqual([]);
  });

  it("coerces an unknown audience to mixed", () => {
    expect(analysisSchema.parse({ ...minimal, target_audience: "robots" }).target_audience).toBe("mixed");
    expect(analysisSchema.parse({ ...minimal, target_audience: "admin" }).target_audience).toBe("admin");
  });

  it("coerces unknown finding type to incomplete and unknown severity to medium", () => {
    const r = analysisSchema.parse({ ...minimal, findings: [{ type: "weird", severity: "extreme", location: null, evidence: null, detail: "d" }] });
    expect(r.findings[0]).toEqual({ type: "incomplete", severity: "medium", location: "", evidence: "", detail: "d" });
  });

  it("keeps valid finding types", () => {
    const r = analysisSchema.parse({ ...minimal, findings: [{ type: "broken_link", severity: "high" }] });
    expect(r.findings[0].type).toBe("broken_link");
    expect(r.findings[0].severity).toBe("high");
  });

  it("rejects a score outside 0..100 or missing", () => {
    expect(() => analysisSchema.parse({ quality_score: 101 })).toThrow();
    expect(() => analysisSchema.parse({ quality_score: -1 })).toThrow();
    expect(() => analysisSchema.parse({})).toThrow();
    expect(() => analysisSchema.parse({ quality_score: "80" })).toThrow();
  });

  it("accepts the boundary scores", () => {
    expect(analysisSchema.parse({ quality_score: 0 }).quality_score).toBe(0);
    expect(analysisSchema.parse({ quality_score: 100 }).quality_score).toBe(100);
  });
});

describe("scoreOnlySchema", () => {
  it("keeps only the score", () => {
    expect(scoreOnlySchema.parse({ quality_score: 5, extra: 1 })).toEqual({ quality_score: 5 });
  });
  it("rejects out of range", () => {
    expect(() => scoreOnlySchema.parse({ quality_score: 200 })).toThrow();
  });
});

describe("enrichmentSchema", () => {
  const base = { ai_ready_knowledge: { extractable: true } };

  it("fills defaults", () => {
    const r = enrichmentSchema.parse(base);
    expect(r.incident_analysis).toEqual([]);
    expect(r.contradictions).toEqual([]);
    expect(r.recommendations).toEqual([]);
    expect(r.confidence).toBe("low");
    expect(r.summary).toBe("");
  });

  it("keeps extra keys on ai_ready_knowledge and contradictions", () => {
    const r = enrichmentSchema.parse({ ai_ready_knowledge: { extractable: true, steps: ["a"] }, contradictions: [{ what: "x" }] });
    expect(r.ai_ready_knowledge).toEqual({ extractable: true, steps: ["a"] });
    expect(r.contradictions).toEqual([{ what: "x" }]);
  });

  it("coerces bad booleans and confidence", () => {
    const r = enrichmentSchema.parse({
      ai_ready_knowledge: { extractable: "yes" },
      confidence: "certain",
      incident_analysis: [{ incident_id: "INC1", relevant: "maybe", new_information: null, contradicts_article: 3 }],
    });
    expect(r.ai_ready_knowledge.extractable).toBe(false);
    expect(r.confidence).toBe("low");
    expect(r.incident_analysis[0]).toEqual({ incident_id: "INC1", relevant: false, new_information: "", contradicts_article: false });
  });

  it("requires ai_ready_knowledge", () => {
    expect(() => enrichmentSchema.parse({})).toThrow();
  });
});

describe("synthesisSchema", () => {
  it("requires non-empty content", () => {
    expect(() => synthesisSchema.parse({ enriched_content: "" })).toThrow();
    expect(() => synthesisSchema.parse({})).toThrow();
  });
  it("fills defaults", () => {
    expect(synthesisSchema.parse({ enriched_content: "x" })).toEqual({ enriched_content: "x", summary: "", resolved_finding_ids: [], unresolved_gaps: [] });
  });
  it("keeps unresolved gap objects with unknown keys", () => {
    expect(synthesisSchema.parse({ enriched_content: "x", unresolved_gaps: [{ gap: "g" }] }).unresolved_gaps).toEqual([{ gap: "g" }]);
  });
});

describe("duplicateSchema", () => {
  it("requires same_topic", () => {
    expect(() => duplicateSchema.parse({})).toThrow();
  });
  it("defaults the more complete article to a when invalid", () => {
    expect(duplicateSchema.parse({ same_topic: true, more_complete_article: "c" }).more_complete_article).toBe("a");
    expect(duplicateSchema.parse({ same_topic: true, more_complete_article: "b" }).more_complete_article).toBe("b");
  });
  it("treats null reasoning as empty", () => {
    expect(duplicateSchema.parse({ same_topic: false, reasoning: null }).reasoning).toBe("");
  });
});

describe("chatAnswerSchema and judgeSchema", () => {
  it("requires a non-empty answer", () => {
    expect(() => chatAnswerSchema.parse({ answer: "" })).toThrow();
    expect(chatAnswerSchema.parse({ answer: "ok" }).answer).toBe("ok");
  });
  it("bounds judge scores to 1..5", () => {
    const ok = { answer_x: { score: 1 }, answer_y: { score: 5, reasoning: "r" } };
    expect(judgeSchema.parse(ok).answer_x.reasoning).toBe("");
    expect(() => judgeSchema.parse({ ...ok, answer_x: { score: 0 } })).toThrow();
    expect(() => judgeSchema.parse({ ...ok, answer_y: { score: 6 } })).toThrow();
  });
});

describe("CONTENT_GAP_TYPES", () => {
  it("lists the six gap types", () => {
    expect([...CONTENT_GAP_TYPES].sort()).toEqual(
      ["incomplete", "missing_context", "missing_prerequisites", "no_error_guidance", "no_resolution_steps", "outdated"],
    );
  });
  it("excludes structure problems", () => {
    for (const t of ["too_vague", "duplicate", "broken_link", "image_dependent"]) expect(CONTENT_GAP_TYPES.has(t)).toBe(false);
  });
});
