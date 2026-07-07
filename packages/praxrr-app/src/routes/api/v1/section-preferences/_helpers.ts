import {
	SECTION_KEY_MAX_LENGTH,
	SECTION_KEY_PATTERN,
	type SectionKey,
} from '$shared/disclosure/sectionKeys.ts';

const STRICT_TRUE = 'true';
const STRICT_FALSE = 'false';

export const SECTION_PREFERENCE_RATE_LIMIT_WINDOW_MS = 30_000;
export const SECTION_PREFERENCE_RATE_LIMIT_MAX_REQUESTS = 8;

type RateLimitState = {
	windowStart: number;
	count: number;
};

/**
 * Per-process in-memory rate limiting for section preference writes.
 * Assumes a single app instance; multi-instance deployments need shared storage
 * for cross-node enforcement.
 */
const rateLimitState = new Map<string, RateLimitState>();

function pruneExpiredRateLimitEntries(now: number): void {
	for (const [key, state] of rateLimitState) {
		if (now - state.windowStart >= SECTION_PREFERENCE_RATE_LIMIT_WINDOW_MS) {
			rateLimitState.delete(key);
		}
	}
}

export function parseSectionKey(raw: unknown): SectionKey {
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

export function parseStrictParam(raw: string | null): boolean {
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

export function checkWriteRateLimit(
	userId: number,
	sectionKey: string,
	rateLimitExceededMessage: string
): string | null {
	const now = Date.now();
	pruneExpiredRateLimitEntries(now);

	const stateKey = `${userId}:${sectionKey}`;
	const existing = rateLimitState.get(stateKey);

	if (!existing || now - existing.windowStart >= SECTION_PREFERENCE_RATE_LIMIT_WINDOW_MS) {
		rateLimitState.set(stateKey, {
			windowStart: now,
			count: 1,
		});
		return null;
	}

	if (existing.count >= SECTION_PREFERENCE_RATE_LIMIT_MAX_REQUESTS) {
		return rateLimitExceededMessage;
	}

	existing.count += 1;
	return null;
}

export function detectConcurrencyConflict(
	existing: { updatedAt: string } | undefined,
	expectedUpdatedAt: string | null | undefined,
	entityLabel: string
): string | null {
	if (expectedUpdatedAt === undefined) {
		return null;
	}

	if (expectedUpdatedAt === null) {
		return null;
	}

	if (!existing) {
		return `Concurrency conflict: ${entityLabel} does not exist`;
	}

	if (existing.updatedAt !== expectedUpdatedAt) {
		return 'Concurrency conflict: expected_updated_at does not match';
	}

	return null;
}
