import { db } from "@/lib/db";

/**
 * Load a comparison only if it belongs to this user.
 * @param comparisonId the comparison
 * @param userId the signed-in user
 * @return the comparison with its arms, or null when missing or not theirs
 */
export async function ownedComparison(comparisonId: string, userId: string) {
  return db.comparison.findFirst({
    where: { id: comparisonId, conversation: { userId } },
    include: { arms: true },
  });
}
