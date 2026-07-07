export const DEFAULT_RATE_LIMIT_WINDOW_MS = 30_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 8;

/**
 * Upper bound on distinct keys tracked at once. Guards against unbounded
 * memory growth from a flood of distinct IPs (e.g. a spoofed-header attack)
 * outpacing the window-based pruning below.
 */
const MAX_TRACKED_KEYS = 10_000;

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

  // Still over the cap after pruning expired entries: drop the oldest
  // windows first rather than let the map grow without bound.
  if (rateLimitState.size > MAX_TRACKED_KEYS) {
    const entries = [...rateLimitState.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    const excess = rateLimitState.size - MAX_TRACKED_KEYS;
    for (const [key] of entries.slice(0, excess)) {
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
