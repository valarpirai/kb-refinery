import { db } from "@/lib/db";

const MAX_INCIDENTS = 20;

/**
 * Find resolved incidents that overlap an article's search terms.
 * Matches any term against the short description or resolution text, and
 * keeps only incidents that have a resolution.
 * @param searchTerms user-facing terms from the analysis call
 * @return up to 20 candidate incidents, newest first
 */
export async function findCandidateIncidents(searchTerms: string[]) {
  const terms = searchTerms.map((t) => t.trim()).filter(Boolean).slice(0, 8);
  if (terms.length === 0) return [];
  return db.incident.findMany({
    where: {
      resolution: { not: "" },
      OR: terms.flatMap((t) => [
        { shortDescription: { contains: t, mode: "insensitive" as const } },
        { resolution: { contains: t, mode: "insensitive" as const } },
      ]),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_INCIDENTS,
  });
}
