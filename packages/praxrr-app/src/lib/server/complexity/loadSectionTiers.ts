import { userComplexityTiersQueries } from '$db/queries/user_complexity_tiers.ts';
import { logger } from '$logger/logger.ts';
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

  try {
    const preferences = userComplexityTiersQueries.getByUserId(userId);
    const tierByKey = new Map(preferences.map((preference) => [preference.sectionKey, preference.tier]));

    for (const key of sectionKeys) {
      const tier = tierByKey.get(key);
      if (tier) {
        tiers[key] = tier;
      }
    }
  } catch (error) {
    void logger.warn('Failed to load complexity tier', {
      source: 'loadSectionTiers',
      meta: {
        userId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  return tiers;
}
