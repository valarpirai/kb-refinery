/**
 * Decide, from a comparison id, whether the refined answer is shown first.
 * Stable for a given id, so the page and the judge agree, but not always the same side.
 * @param comparisonId the comparison id
 * @return true when the refined answer comes first
 */
export function refinedFirst(comparisonId: string): boolean {
  return [...comparisonId].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 2 === 1;
}
