import { z } from "zod";

/** Models often return null for empty fields; treat null and missing the same. */
const str = z.string().nullish().transform((v) => v ?? "");
const strList = z.array(z.string()).nullish().transform((v) => v ?? []);

const findingTypes = [
  "outdated", "incomplete", "image_dependent", "no_resolution_steps", "too_vague",
  "audience_mismatch", "missing_prerequisites", "no_error_guidance", "missing_context",
  "unlinked_product", "broken_link", "duplicate",
] as const;

/** Call 1: quality analysis. */
export const analysisSchema = z.object({
  quality_score: z.number().min(0).max(100),
  target_audience: z.enum(["end_user", "admin", "developer", "mixed"]).catch("mixed"),
  standardized_summary: str,
  findings: z
    .array(
      z.object({
        type: z.enum(findingTypes).catch("incomplete"),
        severity: z.enum(["high", "medium", "low"]).catch("medium"),
        location: str,
        evidence: str,
        detail: str,
      }),
    )
    .default([]),
  search_terms: strList,
  product_mentions: strList,
  summary: str,
});
export type AnalysisResult = z.infer<typeof analysisSchema>;

/** Call 1 reused only for its score (raw and enriched stages). */
export const scoreOnlySchema = z.object({ quality_score: z.number().min(0).max(100) });

/** Call 2: incident-informed enrichment. */
export const enrichmentSchema = z.object({
  incident_analysis: z
    .array(
      z.object({
        incident_id: z.string(),
        relevant: z.boolean().catch(false),
        new_information: str,
        contradicts_article: z.boolean().catch(false),
      }),
    )
    .default([]),
  ai_ready_knowledge: z.looseObject({ extractable: z.boolean().catch(false) }),
  contradictions: z.array(z.looseObject({})).default([]),
  recommendations: strList,
  confidence: z.enum(["high", "medium", "low"]).catch("low"),
  summary: str,
});
export type EnrichmentResult = z.infer<typeof enrichmentSchema>;

/** Call 3: article synthesis. */
export const synthesisSchema = z.object({
  enriched_content: z.string().min(1),
  summary: str,
  resolved_finding_ids: strList,
  unresolved_gaps: z.array(z.looseObject({})).default([]),
});
export type SynthesisResult = z.infer<typeof synthesisSchema>;

/** Duplicate confirmation. */
export const duplicateSchema = z.object({
  same_topic: z.boolean(),
  more_complete_article: z.enum(["a", "b"]).catch("a"),
  reasoning: str,
});

/** Finding types that incident evidence can help repair; others only reach synthesis. */
export const CONTENT_GAP_TYPES = new Set([
  "incomplete", "no_resolution_steps", "missing_prerequisites", "no_error_guidance", "outdated", "missing_context",
]);
