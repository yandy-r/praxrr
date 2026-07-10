/**
 * Per-instance sliding-window rate limit for user-triggered on-demand config-health recomputes
 * (POST /api/v1/config-health/{instanceId}/recompute).
 *
 * Unlike the drift refresh limiter, this is NOT layered on the shared sync-preview budget: config
 * health scoring performs ZERO live Arr I/O (it reads the stored drift row + the in-memory PCD cache
 * + settings — see `gather.ts`), so there is no network cost to bound. The sole purpose of this
 * window is to throttle snapshot/trend WRITES so a burst of clicks cannot flood
 * `config_health_snapshots` with near-identical trend points. Mirrors `$sync/drift/limits.ts`.
 */

export const CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS = 3;

interface RateWindowEntry {
  timestamps: number[];
}

const recomputeWindows = new Map<number, RateWindowEntry>();

function pruneWindow(entry: RateWindowEntry, nowMs: number): void {
  const windowStart = nowMs - CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_WINDOW_MS;
  entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > windowStart);
}

/**
 * Records an on-demand recompute attempt for an instance. Returns `false` (rate limited) when the
 * instance has already used its allowance within the window; `true` otherwise.
 */
export function registerConfigHealthRecomputeAttempt(instanceId: number, nowMs: number): boolean {
  const entry = recomputeWindows.get(instanceId) ?? { timestamps: [] };
  pruneWindow(entry, nowMs);

  if (entry.timestamps.length >= CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS) {
    recomputeWindows.set(instanceId, entry);
    return false;
  }

  entry.timestamps.push(nowMs);
  recomputeWindows.set(instanceId, entry);
  return true;
}

export function resetConfigHealthRecomputeRateLimitForTests(): void {
  recomputeWindows.clear();
}
