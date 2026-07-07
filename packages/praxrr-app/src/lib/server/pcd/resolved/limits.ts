/**
 * Fan-out limits for the resolved-config cross-instance comparison surface (W3).
 *
 * `/compare` fans a single request out to N Arr instances (readers dispatch + optional
 * live preview per instance). Without a cap that fan-out is unbounded per request, and
 * without a rate window a client can issue many such requests back-to-back — both amplify
 * load against every configured Arr instance. `COMPARE_MAX_INSTANCES` bounds the former;
 * `registerCompareAttempt` (built on the generic in-memory limiter in `$utils/rateLimit.ts`)
 * bounds the latter, keyed per user/session so one caller cannot starve another.
 */

import { registerRateLimitAttempt } from '$utils/rateLimit.ts';

/** Maximum number of Arr instances a single cross-instance comparison request may target. */
export const COMPARE_MAX_INSTANCES = 8;

/** Namespaces compare-attempt keys so they never collide with other `registerRateLimitAttempt` callers. */
const COMPARE_RATE_LIMIT_KEY_PREFIX = 'resolved-compare:';

/**
 * Returns whether `count` (the number of requested `instanceIds`) is within the
 * `/compare` fan-out cap. Callers use this to produce a 400 before doing any work.
 */
export function isInstanceCountWithinCap(count: number): boolean {
  return Number.isInteger(count) && count > 0 && count <= COMPARE_MAX_INSTANCES;
}

/**
 * Registers a `/compare` attempt for `key` (a user/session identifier, or a caller-chosen
 * fallback such as `'global'`) and reports whether it is allowed under the shared rate
 * limiter's default window. Returns `true` when allowed, `false` when throttled (route
 * should respond 429).
 */
export function registerCompareAttempt(key: string): boolean {
  return registerRateLimitAttempt(`${COMPARE_RATE_LIMIT_KEY_PREFIX}${key}`);
}
