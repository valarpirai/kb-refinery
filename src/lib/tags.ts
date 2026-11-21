/**
 * Clean up a tag name: trim, collapse spaces, lowercase.
 * @param raw what the user typed
 * @return the stored name, or null when it is empty or too long
 */
export function normalizeTag(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return name.length >= 1 && name.length <= 40 ? name : null;
}

export const MAX_TAGS_PER_ARTICLE = 20;
