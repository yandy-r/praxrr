import { assertEquals } from '@std/assert';
import { db } from '$db/db.ts';
import {
  MAX_COMPLEXITY_ACTIVITY_COUNT,
  userComplexityTiersQueries,
  type UserComplexityTier,
} from '$db/queries/user_complexity_tiers.ts';
import { CF_CONDITIONS, CF_SCORING } from '$shared/disclosure/sectionKeys.ts';

type Restore = () => void;

type StoredTier = UserComplexityTier;

function withInMemoryDb(callback: (store: Map<string, StoredTier>) => void): Restore {
  const store = new Map<string, StoredTier>();
  const originalQueryFirst = db.queryFirst;
  const originalQuery = db.query;
  const originalExecute = db.execute;
  const mapKey = (userId: number, sectionKey: string): string => `${userId}:${sectionKey}`;

  db.queryFirst = ((_: string, userId: number, sectionKey: string) => {
    const record = store.get(mapKey(userId, sectionKey));
    if (!record) {
      return undefined;
    }

    return {
      user_id: record.userId,
      section_key: record.sectionKey,
      tier: record.tier,
      interaction_count: record.interactionCount,
      advanced_toggle_count: record.advancedToggleCount,
      last_suggested_tier: record.lastSuggestedTier,
      suggestion_dismissed_at: record.suggestionDismissedAt,
      updated_at: record.updatedAt,
    };
  }) as typeof db.queryFirst;

  db.query = ((_: string, userId: number) => {
    return Array.from(store.values())
      .filter((record) => record.userId === userId)
      .sort((left, right) => left.sectionKey.localeCompare(right.sectionKey))
      .map((record) => ({
        user_id: record.userId,
        section_key: record.sectionKey,
        tier: record.tier,
        interaction_count: record.interactionCount,
        advanced_toggle_count: record.advancedToggleCount,
        last_suggested_tier: record.lastSuggestedTier,
        suggestion_dismissed_at: record.suggestionDismissedAt,
        updated_at: record.updatedAt,
      }));
  }) as typeof db.query;

  db.execute = ((sql: string, ...params: unknown[]) => {
    if (sql.includes('INSERT INTO user_complexity_tiers')) {
      const [
        userId,
        sectionKey,
        tier,
        interactionCount,
        advancedToggleCount,
        lastSuggestedTier,
        suggestionDismissedAt,
        updatedAt,
      ] = params as [number, typeof CF_CONDITIONS, 'beginner', number, number, null, null, string];
      store.set(mapKey(userId, sectionKey), {
        userId,
        sectionKey,
        tier,
        interactionCount,
        advancedToggleCount,
        lastSuggestedTier,
        suggestionDismissedAt,
        updatedAt,
      });
      return 1;
    }

    if (sql.includes('UPDATE user_complexity_tiers')) {
      const [
        tier,
        interactionCount,
        advancedToggleCount,
        lastSuggestedTier,
        suggestionDismissedAt,
        updatedAt,
        userId,
        sectionKey,
      ] = params as ['beginner', number, number, null, null, string, number, typeof CF_CONDITIONS];
      const existing = store.get(mapKey(userId, sectionKey));
      if (!existing) {
        return 0;
      }
      store.set(mapKey(userId, sectionKey), {
        ...existing,
        tier,
        interactionCount,
        advancedToggleCount,
        lastSuggestedTier,
        suggestionDismissedAt,
        updatedAt,
      });
      return 1;
    }

    return 0;
  }) as typeof db.execute;

  callback(store);

  return () => {
    db.queryFirst = originalQueryFirst;
    db.query = originalQuery;
    db.execute = originalExecute;
  };
}

Deno.test('userComplexityTiersQueries upsert is idempotent when tier state is unchanged', () => {
  let writeCount = 0;
  const restore = withInMemoryDb(() => undefined);
  const originalExecute = db.execute;
  db.execute = ((...args: Parameters<typeof db.execute>) => {
    writeCount += 1;
    return originalExecute.apply(db, args);
  }) as typeof db.execute;

  try {
    const first = userComplexityTiersQueries.upsert({
      userId: 1,
      sectionKey: CF_CONDITIONS,
      tier: 'advanced',
    });
    const second = userComplexityTiersQueries.upsert({
      userId: 1,
      sectionKey: CF_CONDITIONS,
      tier: 'advanced',
    });

    assertEquals(first.tier, 'advanced');
    assertEquals(second.updatedAt, first.updatedAt);
    assertEquals(writeCount, 1);
  } finally {
    db.execute = originalExecute;
    restore();
  }
});

Deno.test('userComplexityTiersQueries incrementActivity clamps counters to a bounded non-negative range', () => {
  const restore = withInMemoryDb(() => undefined);

  try {
    const afterNegative = userComplexityTiersQueries.incrementActivity(2, CF_CONDITIONS, {
      interaction: -10,
      advancedToggle: -10,
    });
    assertEquals(afterNegative.interactionCount, 0);
    assertEquals(afterNegative.advancedToggleCount, 0);

    const afterOverflow = userComplexityTiersQueries.incrementActivity(2, CF_CONDITIONS, {
      interaction: MAX_COMPLEXITY_ACTIVITY_COUNT + 500,
      advancedToggle: MAX_COMPLEXITY_ACTIVITY_COUNT + 500,
    });
    assertEquals(afterOverflow.interactionCount, MAX_COMPLEXITY_ACTIVITY_COUNT);
    assertEquals(afterOverflow.advancedToggleCount, MAX_COMPLEXITY_ACTIVITY_COUNT);
  } finally {
    restore();
  }
});

Deno.test('userComplexityTiersQueries reset returns tier to beginner without touching other sections', () => {
  const restore = withInMemoryDb(() => undefined);

  try {
    userComplexityTiersQueries.upsert({
      userId: 3,
      sectionKey: CF_CONDITIONS,
      tier: 'advanced',
      interactionCount: 8,
      advancedToggleCount: 6,
      lastSuggestedTier: 'advanced',
      suggestionDismissedAt: '2026-07-06T00:00:00.000Z',
    });
    userComplexityTiersQueries.upsert({
      userId: 3,
      sectionKey: CF_SCORING,
      tier: 'advanced',
    });

    const reset = userComplexityTiersQueries.reset(3, CF_CONDITIONS);
    const untouched = userComplexityTiersQueries.getByUserIdAndSectionKey(3, CF_SCORING);

    assertEquals(reset.tier, 'beginner');
    assertEquals(reset.interactionCount, 8);
    assertEquals(reset.advancedToggleCount, 6);
    assertEquals(reset.lastSuggestedTier, null);
    assertEquals(reset.suggestionDismissedAt, null);
    assertEquals(untouched?.tier, 'advanced');
  } finally {
    restore();
  }
});
