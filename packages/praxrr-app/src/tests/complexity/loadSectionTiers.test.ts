import { assertEquals } from '@std/assert';
import { userComplexityTiersQueries, type UserComplexityTier } from '$db/queries/user_complexity_tiers.ts';
import { loadSectionTiers } from '$lib/server/complexity/loadSectionTiers.ts';
import { CF_CONDITIONS, CF_SCORING, type SectionKey } from '$shared/disclosure/sectionKeys.ts';
import type { ComplexityTier } from '$shared/complexity/tiers.ts';

type Restore = () => void;
type TierListQuery = (userId: number) => UserComplexityTier[];

function withGetByUserIdReplacement(replacement: TierListQuery): Restore {
  const original = userComplexityTiersQueries.getByUserId;
  userComplexityTiersQueries.getByUserId = replacement;

  return () => {
    userComplexityTiersQueries.getByUserId = original;
  };
}

Deno.test('loadSectionTiers returns beginner for all keys when userId is undefined', () => {
  const restore = withGetByUserIdReplacement(() => {
    throw new Error('should not query tiers when no user is provided');
  });

  try {
    const sectionTiers = loadSectionTiers(undefined, [CF_CONDITIONS, CF_SCORING]);

    assertEquals(sectionTiers, {
      [CF_CONDITIONS]: 'beginner',
      [CF_SCORING]: 'beginner',
    });
  } finally {
    restore();
  }
});

Deno.test('loadSectionTiers overlays persisted tiers with beginner defaults for missing rows', () => {
  const storedTier: ComplexityTier = 'advanced';

  const restore = withGetByUserIdReplacement((userId) => {
    if (userId === 3) {
      return [
        {
          userId,
          sectionKey: CF_CONDITIONS,
          tier: storedTier,
          interactionCount: 0,
          advancedToggleCount: 0,
          lastSuggestedTier: null,
          suggestionDismissedAt: null,
          updatedAt: new Date().toISOString(),
        },
      ];
    }

    return [];
  });

  try {
    const sectionTiers = loadSectionTiers(3, [CF_CONDITIONS, CF_SCORING]);

    assertEquals(sectionTiers, {
      [CF_CONDITIONS]: 'advanced',
      [CF_SCORING]: 'beginner',
    });
  } finally {
    restore();
  }
});

Deno.test('loadSectionTiers returns empty map for empty sectionKeys input', () => {
  const sectionTiers = loadSectionTiers(99, []);
  assertEquals(sectionTiers, {});
});

Deno.test('loadSectionTiers falls back to beginner when tier query throws', () => {
  const restore = withGetByUserIdReplacement(() => {
    throw new Error('simulated database failure');
  });

  try {
    const sectionTiers = loadSectionTiers(1, [CF_SCORING]);

    assertEquals(sectionTiers, {
      [CF_SCORING]: 'beginner',
    });
  } finally {
    restore();
  }
});
