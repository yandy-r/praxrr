import { db } from '../db.ts';
import {
  SECTION_KEY_MAX_LENGTH,
  SECTION_KEY_PATTERN,
  type ComplexityTier,
  type SectionKey,
} from '$shared/complexity/tiers.ts';

export const MAX_COMPLEXITY_ACTIVITY_COUNT = 1_000_000;

export interface UserComplexityTier {
  userId: number;
  sectionKey: SectionKey;
  tier: ComplexityTier;
  interactionCount: number;
  advancedToggleCount: number;
  lastSuggestedTier: ComplexityTier | null;
  suggestionDismissedAt: string | null;
  updatedAt: string;
}

export interface UserComplexityTierInput {
  userId: number;
  sectionKey: SectionKey;
  tier: ComplexityTier;
  interactionCount?: number;
  advancedToggleCount?: number;
  lastSuggestedTier?: ComplexityTier | null;
  suggestionDismissedAt?: string | null;
}

export interface UserComplexityActivityInput {
  interaction?: number;
  advancedToggle?: number;
}

export interface UserComplexityTierUpdateIfUpdatedAtInput {
  userId: number;
  sectionKey: SectionKey;
  tier: ComplexityTier;
  interactionCount: number;
  advancedToggleCount: number;
  lastSuggestedTier: ComplexityTier | null;
  suggestionDismissedAt: string | null;
  expectedUpdatedAt: string;
}

interface UserComplexityTierRow {
  user_id: number;
  section_key: string;
  tier: ComplexityTier;
  interaction_count: number;
  advanced_toggle_count: number;
  last_suggested_tier: ComplexityTier | null;
  suggestion_dismissed_at: string | null;
  updated_at: string;
}

function rowToTier(row: UserComplexityTierRow): UserComplexityTier {
  return {
    userId: row.user_id,
    sectionKey: row.section_key as SectionKey,
    tier: row.tier,
    interactionCount: row.interaction_count,
    advancedToggleCount: row.advanced_toggle_count,
    lastSuggestedTier: row.last_suggested_tier,
    suggestionDismissedAt: row.suggestion_dismissed_at,
    updatedAt: row.updated_at,
  };
}

function assertSectionKey(sectionKey: string): void {
  if (sectionKey.length > SECTION_KEY_MAX_LENGTH) {
    throw new Error(`Invalid complexity section key format: ${sectionKey}`);
  }

  if (!SECTION_KEY_PATTERN.test(sectionKey)) {
    throw new Error(`Invalid complexity section key format: ${sectionKey}`);
  }
}

function clampCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(MAX_COMPLEXITY_ACTIVITY_COUNT, Math.trunc(value)));
}

function addBoundedCount(current: number, delta: number | undefined): number {
  return clampCount(current + clampCount(delta));
}

export const userComplexityTiersQueries = {
  /**
   * Validate a section key against the canonical route-family key format.
   */
  isValidSectionKey(sectionKey: string): boolean {
    return SECTION_KEY_PATTERN.test(sectionKey);
  },

  /**
   * Get a single complexity tier for a user and section key.
   */
  getByUserIdAndSectionKey(userId: number, sectionKey: SectionKey): UserComplexityTier | undefined {
    assertSectionKey(sectionKey);

    const row = db.queryFirst<UserComplexityTierRow>(
      'SELECT * FROM user_complexity_tiers WHERE user_id = ? AND section_key = ?',
      userId,
      sectionKey
    );

    return row ? rowToTier(row) : undefined;
  },

  /**
   * List all complexity tiers for a user.
   */
  getByUserId(userId: number): UserComplexityTier[] {
    return db
      .query<UserComplexityTierRow>(
        'SELECT * FROM user_complexity_tiers WHERE user_id = ? ORDER BY section_key',
        userId
      )
      .map(rowToTier);
  },

  /**
   * Create or update a tier value.
   * Writes are idempotent when all persisted values match current state.
   */
  upsert(input: UserComplexityTierInput): UserComplexityTier {
    assertSectionKey(input.sectionKey);

    const existing = this.getByUserIdAndSectionKey(input.userId, input.sectionKey);
    const nextInteractionCount = clampCount(input.interactionCount ?? existing?.interactionCount);
    const nextAdvancedToggleCount = clampCount(input.advancedToggleCount ?? existing?.advancedToggleCount);
    const nextLastSuggestedTier =
      input.lastSuggestedTier !== undefined ? input.lastSuggestedTier : (existing?.lastSuggestedTier ?? null);
    const nextSuggestionDismissedAt =
      input.suggestionDismissedAt !== undefined
        ? input.suggestionDismissedAt
        : (existing?.suggestionDismissedAt ?? null);

    if (
      existing &&
      existing.tier === input.tier &&
      existing.interactionCount === nextInteractionCount &&
      existing.advancedToggleCount === nextAdvancedToggleCount &&
      existing.lastSuggestedTier === nextLastSuggestedTier &&
      existing.suggestionDismissedAt === nextSuggestionDismissedAt
    ) {
      return existing;
    }

    const now = new Date().toISOString();

    if (existing) {
      db.execute(
        `UPDATE user_complexity_tiers
		 SET tier = ?, interaction_count = ?, advanced_toggle_count = ?, last_suggested_tier = ?, suggestion_dismissed_at = ?, updated_at = ?
		 WHERE user_id = ? AND section_key = ?`,
        input.tier,
        nextInteractionCount,
        nextAdvancedToggleCount,
        nextLastSuggestedTier,
        nextSuggestionDismissedAt,
        now,
        input.userId,
        input.sectionKey
      );
    } else {
      db.execute(
        `INSERT INTO user_complexity_tiers (
			user_id,
			section_key,
			tier,
			interaction_count,
			advanced_toggle_count,
			last_suggested_tier,
			suggestion_dismissed_at,
			updated_at
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.userId,
        input.sectionKey,
        input.tier,
        nextInteractionCount,
        nextAdvancedToggleCount,
        nextLastSuggestedTier,
        nextSuggestionDismissedAt,
        now
      );
    }

    const updated = this.getByUserIdAndSectionKey(input.userId, input.sectionKey);
    if (!updated) {
      throw new Error('Failed to persist user complexity tier');
    }

    return updated;
  },

  /**
   * Update a tier only when the stored updated_at matches the expected value.
   */
  updateIfUpdatedAt(input: UserComplexityTierUpdateIfUpdatedAtInput): UserComplexityTier | null {
    assertSectionKey(input.sectionKey);

    const now = new Date().toISOString();
    const updatedRows = db.execute(
      `UPDATE user_complexity_tiers
		 SET tier = ?, interaction_count = ?, advanced_toggle_count = ?, last_suggested_tier = ?, suggestion_dismissed_at = ?, updated_at = ?
		 WHERE user_id = ? AND section_key = ? AND updated_at = ?`,
      input.tier,
      input.interactionCount,
      input.advancedToggleCount,
      input.lastSuggestedTier,
      input.suggestionDismissedAt,
      now,
      input.userId,
      input.sectionKey,
      input.expectedUpdatedAt
    );

    if (updatedRows === 0) {
      return null;
    }

    return this.getByUserIdAndSectionKey(input.userId, input.sectionKey) ?? null;
  },

  /**
   * Increment bounded activity counters, creating a beginner row if necessary.
   */
  incrementActivity(userId: number, sectionKey: SectionKey, activity: UserComplexityActivityInput): UserComplexityTier {
    assertSectionKey(sectionKey);

    const existing = this.getByUserIdAndSectionKey(userId, sectionKey);
    const tier = existing?.tier ?? 'beginner';
    const interactionCount = addBoundedCount(existing?.interactionCount ?? 0, activity.interaction);
    const advancedToggleCount = addBoundedCount(existing?.advancedToggleCount ?? 0, activity.advancedToggle);

    return this.upsert({
      userId,
      sectionKey,
      tier,
      interactionCount,
      advancedToggleCount,
      lastSuggestedTier: existing?.lastSuggestedTier ?? null,
      suggestionDismissedAt: existing?.suggestionDismissedAt ?? null,
    });
  },

  /**
   * Reset a section to the beginner tier without touching disclosure mode overrides.
   */
  reset(userId: number, sectionKey: SectionKey): UserComplexityTier {
    assertSectionKey(sectionKey);

    const existing = this.getByUserIdAndSectionKey(userId, sectionKey);
    return this.upsert({
      userId,
      sectionKey,
      tier: 'beginner',
      interactionCount: existing?.interactionCount ?? 0,
      advancedToggleCount: existing?.advancedToggleCount ?? 0,
      lastSuggestedTier: null,
      suggestionDismissedAt: null,
    });
  },
};
