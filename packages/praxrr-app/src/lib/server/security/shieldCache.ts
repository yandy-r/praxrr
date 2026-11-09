/**
 * Process-wide, short-lived cache of the security posture headline (score + band).
 *
 * Shared by the Prometheus metrics collector and the home dashboard so neither triggers a fresh
 * posture computation (bounded DNS evidence lookups) per scrape / page load.
 *
 * The posture only depends on the request through its resolved session transport
 * (`resolveSessionTransport`), so entries are keyed on that value: two different transports never
 * share a result, while every request with the same transport does. Concurrent misses share one
 * in-flight computation; failures are never cached as values, but a failure starts a short
 * cooldown (SHIELD_FAILURE_COOLDOWN_MS) during which callers fail fast without recomputing.
 */

import type { SessionRequestContext, SessionTransport } from '$shared/security/index.ts';
import { computeShield } from './service.ts';
import { resolveSessionTransport } from './sessionTransport.ts';

export interface CachedShieldValue {
  score: number;
  band: 'hardened' | 'guarded' | 'exposed' | 'unknown';
}

interface ShieldCacheEntry {
  value: CachedShieldValue;
  at: number;
}

export const SHIELD_CACHE_TTL_MS = 60_000;

const shieldCache = new Map<SessionTransport, ShieldCacheEntry>();
const shieldInFlight = new Map<SessionTransport, Promise<CachedShieldValue>>();

/** Short failure cooldown: a failing computation is not retried per scrape/page load. */
export const SHIELD_FAILURE_COOLDOWN_MS = 5_000;
const shieldFailures = new Map<SessionTransport, { error: unknown; at: number }>();

let compute: typeof computeShield = computeShield;

/** Test seam: swap the posture computation; returns a restore function. */
export function overrideShieldComputeForTest(fn: typeof computeShield): () => void {
  const previous = compute;
  compute = fn;
  return () => {
    compute = previous;
  };
}

// ponytail: in-process cache avoids DNS lookups per scrape/page load; upgrade to a shared cache
// keyed by instance set when multiple workers serve concurrently.
export function cachedShield(event?: SessionRequestContext): Promise<CachedShieldValue> {
  const key = resolveSessionTransport(event);
  const entry = shieldCache.get(key);
  if (entry && Date.now() - entry.at < SHIELD_CACHE_TTL_MS) {
    return Promise.resolve(entry.value);
  }

  const failure = shieldFailures.get(key);
  if (failure) {
    if (Date.now() - failure.at < SHIELD_FAILURE_COOLDOWN_MS) {
      return Promise.reject(failure.error);
    }
    shieldFailures.delete(key);
  }

  const pending = shieldInFlight.get(key);
  if (pending) return pending;

  // Uses the process-wide resolver seam (overridable in tests); the resolver's own in-process
  // cache plus this cache keep DNS lookups off the hot path.
  const computation: Promise<CachedShieldValue> = compute(event)
    .then((report) => {
      const value: CachedShieldValue = { score: report.score, band: report.band };
      shieldCache.set(key, { value, at: Date.now() });
      shieldFailures.delete(key);
      return value;
    })
    .catch((error) => {
      shieldFailures.set(key, { error, at: Date.now() });
      throw error;
    })
    .finally(() => {
      if (shieldInFlight.get(key) === computation) shieldInFlight.delete(key);
    });
  shieldInFlight.set(key, computation);
  return computation;
}

/** Test seam: reset the in-process shield cache (and any in-flight sharing). */
export function resetShieldCacheForTest(): void {
  shieldCache.clear();
  shieldInFlight.clear();
  shieldFailures.clear();
}
