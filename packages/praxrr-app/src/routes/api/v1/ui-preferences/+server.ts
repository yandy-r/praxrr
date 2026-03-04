import { db } from '$db/db.ts';
import { userInterfacePreferencesQueries } from '$db/queries/user_interface_preferences.ts';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { UserInterfacePreference } from '$db/queries/user_interface_preferences.ts';
import {
  SECTION_KEY_MAX_LENGTH,
  SECTION_KEY_PATTERN,
  type SectionKey,
  type UiPreferenceMode,
} from '$shared/disclosure/sectionKeys.ts';

type ErrorResponse = {
  error: string;
};

type UiMode = UiPreferenceMode;

type UiPreferenceRecord = {
  section_key: string;
  mode: UiMode;
  updated_at: string | null;
  persisted: boolean;
};

const DEFAULT_MODE: UiMode = 'basic';
const STRICT_TRUE = 'true';
const STRICT_FALSE = 'false';
const RATE_LIMIT_WINDOW_MS = 30_000;
const RATE_LIMIT_MAX_REQUESTS = 8;

type RateLimitState = {
  windowStart: number;
  count: number;
};

const rateLimitState = new Map<string, RateLimitState>();

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

  let preference: UserInterfacePreference | undefined;
  try {
    preference = userInterfacePreferencesQueries.getByUserIdAndSectionKey(locals.user.id, sectionKey);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Failed to read preference' }, { status: 500 });
  }

  if (!preference) {
    if (strict) {
      return json({ error: 'Preference not found' }, { status: 404 });
    }

    return json(defaultPreference(sectionKey));
  }

  return json(toUiPreferenceRecord(preference));
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

  let sectionKey: SectionKey;
  let mode: UiMode;
  let expectedUpdatedAt: string | null | undefined;

  try {
    sectionKey = parseSectionKey(body.section_key);
    mode = parseMode(body.mode);
    expectedUpdatedAt = parseExpectedUpdatedAt(body.expected_updated_at);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid request body' }, { status: 400 });
  }

  const rateLimitError = checkWriteRateLimit(locals.user.id, sectionKey);
  if (rateLimitError) {
    return json({ error: rateLimitError }, { status: 429 });
  }

  let existing: UserInterfacePreference | undefined;
  try {
    existing = userInterfacePreferencesQueries.getByUserIdAndSectionKey(locals.user.id, sectionKey);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to load current preference' },
      { status: 500 }
    );
  }

  try {
    const optimisticConflict = detectConcurrencyConflict(existing, expectedUpdatedAt);
    if (optimisticConflict) {
      return json({ error: optimisticConflict }, { status: 409 });
    }

    if (existing && existing.mode === mode) {
      return json(toUiPreferenceRecord(existing));
    }

    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && existing && existing.mode !== mode) {
      const updated = applyConcurrentUpsert({
        userId: locals.user.id,
        sectionKey,
        mode,
        expectedUpdatedAt,
      });
      if (!updated) {
        return json({ error: 'Preference updated concurrently' }, { status: 409 });
      }

      return json(toUiPreferenceRecord(updated));
    }

    if (!existing || existing.mode !== mode) {
      const updated = upsertPreference(locals.user.id, sectionKey, mode);
      return json(toUiPreferenceRecord(updated));
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return json({ error: 'Preference updated concurrently' }, { status: 409 });
    }

    return json({ error: error instanceof Error ? error.message : 'Unable to save preference' }, { status: 500 });
  }

  return json({ error: 'Preference update failed' }, { status: 500 });
};

function detectConcurrencyConflict(
  existing: UserInterfacePreference | undefined,
  expectedUpdatedAt: string | null | undefined
): string | null {
  if (expectedUpdatedAt === undefined) {
    return null;
  }

  // Do not treat null as conflict when a row exists: client may send null before hydration
  // or after a transient read failure; allow the write and let the client catch up.
  if (expectedUpdatedAt === null) {
    return null;
  }

  if (!existing) {
    return 'Concurrency conflict: preference does not exist';
  }

  if (existing.updatedAt !== expectedUpdatedAt) {
    return 'Concurrency conflict: expected_updated_at does not match';
  }

  return null;
}

function parseSectionKey(raw: unknown): SectionKey {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('section_key is required');
  }

  const sectionKey = raw.trim();
  if (sectionKey.length > SECTION_KEY_MAX_LENGTH) {
    throw new Error('Invalid section_key format');
  }
  if (!SECTION_KEY_PATTERN.test(sectionKey)) {
    throw new Error('Invalid section_key format');
  }

  return sectionKey as SectionKey;
}

function checkWriteRateLimit(userId: number, sectionKey: string): string | null {
  const now = Date.now();
  const stateKey = `${userId}:${sectionKey}`;
  const existing = rateLimitState.get(stateKey);

  if (!existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(stateKey, {
      windowStart: now,
      count: 1,
    });
    return null;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return 'Too many preference updates in a short period. Please retry later.';
  }

  existing.count += 1;
  return null;
}

function parseStrictParam(raw: string | null): boolean {
  if (raw === null) {
    return false;
  }
  if (raw === STRICT_TRUE) {
    return true;
  }
  if (raw === STRICT_FALSE) {
    return false;
  }
  throw new Error(`strict must be "${STRICT_TRUE}" or "${STRICT_FALSE}"`);
}

function parseMode(raw: unknown): UiMode {
  if (raw !== 'basic' && raw !== 'advanced') {
    throw new Error('mode is required and must be "basic" or "advanced"');
  }

  return raw;
}

function parseExpectedUpdatedAt(raw: unknown): string | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('expected_updated_at must be a nullable datetime string');
  }

  const normalized = raw.trim();
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error('expected_updated_at must be a valid datetime string');
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toUiPreferenceRecord(preference: UserInterfacePreference): UiPreferenceRecord {
  return {
    section_key: preference.sectionKey,
    mode: preference.mode,
    updated_at: preference.updatedAt,
    persisted: true,
  };
}

function defaultPreference(sectionKey: SectionKey): UiPreferenceRecord {
  return {
    section_key: sectionKey,
    mode: DEFAULT_MODE,
    updated_at: null,
    persisted: false,
  };
}

function upsertPreference(userId: number, sectionKey: SectionKey, mode: UiMode): UserInterfacePreference {
  return userInterfacePreferencesQueries.upsert({
    userId,
    sectionKey,
    mode,
  });
}

function applyConcurrentUpsert({
  userId,
  sectionKey,
  mode,
  expectedUpdatedAt,
}: {
  userId: number;
  sectionKey: SectionKey;
  mode: UiMode;
  expectedUpdatedAt: string;
}): UserInterfacePreference | null {
  const now = new Date().toISOString();
  const updatedRows = db.execute(
    `UPDATE user_interface_preferences
		 SET mode = ?, updated_at = ?
		 WHERE user_id = ? AND section_key = ? AND updated_at = ?`,
    mode,
    now,
    userId,
    sectionKey,
    expectedUpdatedAt
  );

  if (updatedRows === 0) {
    return null;
  }

  const updated = userInterfacePreferencesQueries.getByUserIdAndSectionKey(userId, sectionKey);
  return updated ?? null;
}
