import { MAX_COMPLEXITY_ACTIVITY_COUNT, userComplexityTiersQueries } from '$db/queries/user_complexity_tiers.ts';
import { logger } from '$logger/logger.ts';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { UserComplexityTier } from '$db/queries/user_complexity_tiers.ts';
import { COMPLEXITY_TIERS, type ComplexityTier, type SectionKey } from '$shared/complexity/tiers.ts';
import {
  checkWriteRateLimit,
  detectConcurrencyConflict,
  parseSectionKey,
  parseStrictParam,
} from '../section-preferences/_helpers.ts';

type ErrorResponse = {
  error: string;
};

type ComplexityTierRecord = {
  section_key: string;
  tier: ComplexityTier;
  interaction_count: number;
  advanced_toggle_count: number;
  last_suggested_tier: ComplexityTier | null;
  suggestion_dismissed_at: string | null;
  updated_at: string | null;
  persisted: boolean;
};

type ParsedPatchBody = {
  sectionKey: SectionKey;
  tier: ComplexityTier;
  expectedUpdatedAt: string | null | undefined;
  interactionDelta: number;
  advancedToggleDelta: number;
  lastSuggestedTier: ComplexityTier | null | undefined;
  suggestionDismissedAt: string | null | undefined;
};

const DEFAULT_TIER: ComplexityTier = 'beginner';
const MAX_COUNTER_DELTA_PER_REQUEST = 100;
const RATE_LIMIT_EXCEEDED_MESSAGE = 'Too many complexity tier updates in a short period. Please retry later.';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  let sectionKey: SectionKey;
  try {
    sectionKey = parseSectionKey(url.searchParams.get('section_key'));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid section_key' }, { status: 400 });
  }

  let strict: boolean;
  try {
    strict = parseStrictParam(url.searchParams.get('strict'));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid strict query parameter' }, { status: 400 });
  }

  if (locals.user.id <= 0) {
    return json(defaultTierRecord(sectionKey));
  }

  let tier: UserComplexityTier | undefined;
  try {
    tier = userComplexityTiersQueries.getByUserIdAndSectionKey(locals.user.id, sectionKey);
  } catch (error) {
    await logger.error('Failed to read complexity tier', {
      source: 'complexity-tiers',
      meta: {
        userId: locals.user.id,
        sectionKey,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return json({ error: 'Failed to read complexity tier' }, { status: 500 });
  }

  if (!tier) {
    if (strict) {
      return json({ error: 'Complexity tier not found' }, { status: 404 });
    }

    return json(defaultTierRecord(sectionKey));
  }

  return json(toComplexityTierRecord(tier));
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isRecord(body)) {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  let parsed: ParsedPatchBody;
  try {
    parsed = parsePatchBody(body);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid request body' }, { status: 400 });
  }

  if (locals.user.id <= 0) {
    return json(defaultTierRecord(parsed.sectionKey));
  }

  const rateLimitError = checkWriteRateLimit(locals.user.id, parsed.sectionKey, RATE_LIMIT_EXCEEDED_MESSAGE);
  if (rateLimitError) {
    return json({ error: rateLimitError }, { status: 429 });
  }

  let existing: UserComplexityTier | undefined;
  try {
    existing = userComplexityTiersQueries.getByUserIdAndSectionKey(locals.user.id, parsed.sectionKey);
  } catch (error) {
    await logger.error('Failed to load current complexity tier', {
      source: 'complexity-tiers',
      meta: {
        userId: locals.user.id,
        sectionKey: parsed.sectionKey,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return json({ error: 'Failed to load current complexity tier' }, { status: 500 });
  }

  try {
    const optimisticConflict = detectConcurrencyConflict(existing, parsed.expectedUpdatedAt, 'complexity tier');
    if (optimisticConflict) {
      return json({ error: optimisticConflict }, { status: 409 });
    }

    const nextInteractionCount = clampCount((existing?.interactionCount ?? 0) + parsed.interactionDelta);
    const nextAdvancedToggleCount = clampCount((existing?.advancedToggleCount ?? 0) + parsed.advancedToggleDelta);
    const nextLastSuggestedTier =
      parsed.lastSuggestedTier !== undefined ? parsed.lastSuggestedTier : (existing?.lastSuggestedTier ?? null);
    const nextSuggestionDismissedAt =
      parsed.suggestionDismissedAt !== undefined
        ? parsed.suggestionDismissedAt
        : (existing?.suggestionDismissedAt ?? null);

    if (
      existing &&
      existing.tier === parsed.tier &&
      existing.interactionCount === nextInteractionCount &&
      existing.advancedToggleCount === nextAdvancedToggleCount &&
      existing.lastSuggestedTier === nextLastSuggestedTier &&
      existing.suggestionDismissedAt === nextSuggestionDismissedAt
    ) {
      return json(toComplexityTierRecord(existing));
    }

    if (
      parsed.expectedUpdatedAt !== undefined &&
      parsed.expectedUpdatedAt !== null &&
      existing &&
      hasTierChanged(existing, parsed)
    ) {
      const updated = userComplexityTiersQueries.updateIfUpdatedAt({
        userId: locals.user.id,
        sectionKey: parsed.sectionKey,
        tier: parsed.tier,
        interactionCount: nextInteractionCount,
        advancedToggleCount: nextAdvancedToggleCount,
        lastSuggestedTier: nextLastSuggestedTier,
        suggestionDismissedAt: nextSuggestionDismissedAt,
        expectedUpdatedAt: parsed.expectedUpdatedAt,
      });
      if (!updated) {
        return json({ error: 'Complexity tier updated concurrently' }, { status: 409 });
      }

      return json(toComplexityTierRecord(updated));
    }

    const updated = userComplexityTiersQueries.upsert({
      userId: locals.user.id,
      sectionKey: parsed.sectionKey,
      tier: parsed.tier,
      interactionCount: nextInteractionCount,
      advancedToggleCount: nextAdvancedToggleCount,
      lastSuggestedTier: nextLastSuggestedTier,
      suggestionDismissedAt: nextSuggestionDismissedAt,
    });
    return json(toComplexityTierRecord(updated));
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return json({ error: 'Complexity tier updated concurrently' }, { status: 409 });
    }

    await logger.error('Unable to save complexity tier', {
      source: 'complexity-tiers',
      meta: {
        userId: locals.user.id,
        sectionKey: parsed.sectionKey,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return json({ error: 'Unable to save complexity tier' }, { status: 500 });
  }
};

function parsePatchBody(body: Record<string, unknown>): ParsedPatchBody {
  return {
    sectionKey: parseSectionKey(body.section_key),
    tier: parseTier(body.tier),
    expectedUpdatedAt: parseExpectedUpdatedAt(body.expected_updated_at),
    interactionDelta: parseOptionalCounterDelta(body.interaction_delta, 'interaction_delta'),
    advancedToggleDelta: parseOptionalCounterDelta(body.advanced_toggle_delta, 'advanced_toggle_delta'),
    lastSuggestedTier: parseOptionalTier(body.last_suggested_tier, 'last_suggested_tier'),
    suggestionDismissedAt: parseOptionalNullableDate(body.suggestion_dismissed_at, 'suggestion_dismissed_at'),
  };
}

function parseTier(raw: unknown): ComplexityTier {
  if (raw === 'beginner' || raw === 'intermediate' || raw === 'advanced') {
    return raw;
  }

  throw new Error(`tier is required and must be one of: ${COMPLEXITY_TIERS.join(', ')}`);
}

function parseOptionalTier(raw: unknown, field: string): ComplexityTier | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  try {
    return parseTier(raw);
  } catch {
    throw new Error(`${field} must be null or one of: ${COMPLEXITY_TIERS.join(', ')}`);
  }
}

function parseExpectedUpdatedAt(raw: unknown): string | null | undefined {
  return parseOptionalNullableDate(raw, 'expected_updated_at');
}

function parseOptionalNullableDate(raw: unknown, field: string): string | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`${field} must be a nullable datetime string`);
  }

  const normalized = raw.trim();
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} must be a valid datetime string`);
  }

  return normalized;
}

function parseOptionalCounterDelta(raw: unknown, field: string): number {
  if (raw === undefined || raw === null) {
    return 0;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${field} must be a finite number`);
  }

  const delta = Math.trunc(raw);
  return Math.max(-MAX_COUNTER_DELTA_PER_REQUEST, Math.min(MAX_COUNTER_DELTA_PER_REQUEST, delta));
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(MAX_COMPLEXITY_ACTIVITY_COUNT, Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toComplexityTierRecord(tier: UserComplexityTier): ComplexityTierRecord {
  return {
    section_key: tier.sectionKey,
    tier: tier.tier,
    interaction_count: tier.interactionCount,
    advanced_toggle_count: tier.advancedToggleCount,
    last_suggested_tier: tier.lastSuggestedTier,
    suggestion_dismissed_at: tier.suggestionDismissedAt,
    updated_at: tier.updatedAt,
    persisted: true,
  };
}

function defaultTierRecord(sectionKey: SectionKey): ComplexityTierRecord {
  return {
    section_key: sectionKey,
    tier: DEFAULT_TIER,
    interaction_count: 0,
    advanced_toggle_count: 0,
    last_suggested_tier: null,
    suggestion_dismissed_at: null,
    updated_at: null,
    persisted: false,
  };
}

function hasTierChanged(existing: UserComplexityTier, parsed: ParsedPatchBody): boolean {
  return (
    existing.tier !== parsed.tier ||
    parsed.interactionDelta !== 0 ||
    parsed.advancedToggleDelta !== 0 ||
    parsed.lastSuggestedTier !== undefined ||
    parsed.suggestionDismissedAt !== undefined
  );
}
