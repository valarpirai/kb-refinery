/** One finding as the prompts expect it, labeled [F1], [F2], ... */
export interface PromptFinding {
  type: string;
  severity?: string | null;
  location?: string;
  evidence?: string;
  detail?: string | null;
}

/**
 * Render findings as a labeled list for the enrichment and synthesis prompts.
 * @param findings findings in a stable order; the index becomes the label
 * @return text with one finding per line, or "(none)"
 */
export function formatFindings(findings: PromptFinding[]): string {
  if (findings.length === 0) return "(none)";
  return findings
    .map((f, i) => {
      const where = f.location ? ` in "${f.location}"` : "";
      const quote = f.evidence ? ` Quote: "${f.evidence}".` : "";
      return `[F${i + 1}] ${f.type} (${f.severity ?? "medium"})${where}: ${f.detail ?? ""}${quote}`;
    })
    .join("\n");
}

/**
 * Render incidents for the enrichment prompt.
 * @param incidents incidents with number, short description and resolution
 * @return text with one incident per block, or "(none)"
 */
export function formatIncidents(
  incidents: { number: string; shortDescription: string; resolution: string }[],
): string {
  if (incidents.length === 0) return "(none)";
  return incidents
    .map((i) => `- ${i.number}: ${i.shortDescription}\n  Resolution: ${i.resolution}`)
    .join("\n");
}

/**
 * Render JSON-like data for a prompt, or "(none)" when empty.
 * @param value any serializable value
 * @return pretty JSON text or "(none)"
 */
export function jsonOrNone(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (Array.isArray(value) && value.length === 0) return "(none)";
  return JSON.stringify(value, null, 2);
}
