import { userComplexityTiersQueries } from '$db/queries/user_complexity_tiers.ts';
import type { ComplexityTier, SectionKey } from '$shared/complexity/tiers.ts';

/**
 * Load persisted complexity tiers for a set of disclosure keys.
 * Returns a record mapping each key to its stored tier, defaulting
 * absent rows to `'beginner'`.
 */
export function loadSectionTiers<K extends SectionKey>(
  userId: number | undefined,
  sectionKeys: readonly K[]
): Record<K, ComplexityTier> {
  const tiers = {} as Record<K, ComplexityTier>;

  for (const key of sectionKeys) {
    tiers[key] = 'beginner';
  }

  if (!userId) {
    return tiers;
  }

  for (const key of sectionKeys) {
    try {
      const preference = userComplexityTiersQueries.getByUserIdAndSectionKey(userId, key);
      if (preference?.tier) {
        tiers[key] = preference.tier;
      }
    } catch (error) {
      console.warn('Failed to load complexity tier', {
        userId,
        sectionKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return tiers;
}
