export const DEFAULT_RATE_LIMIT_WINDOW_MS = 30_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 8;

type RateLimitState = {
  windowStart: number;
  count: number;
};

type RateLimitOptions = {
  windowMs?: number;
  maxRequests?: number;
};

/**
 * Per-process in-memory rate limiting keyed by an arbitrary string (IP, userId, etc).
 * Assumes a single app instance; multi-instance deployments need shared storage
 * for cross-node enforcement.
 */
const rateLimitState = new Map<string, RateLimitState>();

function pruneExpiredRateLimitEntries(now: number, windowMs: number): void {
  for (const [key, state] of rateLimitState) {
    if (now - state.windowStart >= windowMs) {
      rateLimitState.delete(key);
    }
  }
}

/**
 * Registers an attempt for `key` and reports whether it is allowed under the
 * configured token-bucket window. Returns `true` when allowed, `false` when throttled.
 */
export function registerRateLimitAttempt(key: string, opts?: RateLimitOptions): boolean {
  const windowMs = opts?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const maxRequests = opts?.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS;

  const now = Date.now();
  pruneExpiredRateLimitEntries(now, windowMs);

  const existing = rateLimitState.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    rateLimitState.set(key, {
      windowStart: now,
      count: 1,
    });
    return true;
  }

  if (existing.count >= maxRequests) {
    return false;
  }

  existing.count += 1;
  return true;
}

export function resetRateLimitForTests(): void {
  rateLimitState.clear();
}
