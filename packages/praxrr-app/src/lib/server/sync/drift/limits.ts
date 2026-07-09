/**
 * Per-instance sliding-window rate limit for user-triggered on-demand drift refreshes
 * (POST /api/v1/drift/{instanceId}). Distinct from — and layered on top of — the shared
 * `registerPreviewCreateAttempt` window that also gates the scheduled sweep.
 */

export const DRIFT_REFRESH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const DRIFT_REFRESH_RATE_LIMIT_MAX_REQUESTS = 3;

interface RateWindowEntry {
  timestamps: number[];
}

const driftRefreshWindows = new Map<number, RateWindowEntry>();

function pruneWindow(entry: RateWindowEntry, nowMs: number): void {
  const windowStart = nowMs - DRIFT_REFRESH_RATE_LIMIT_WINDOW_MS;
  entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > windowStart);
}

/**
 * Records an on-demand refresh attempt for an instance. Returns `false` (rate limited) when
 * the instance has already used its allowance within the window; `true` otherwise.
 */
export function registerDriftRefreshAttempt(instanceId: number, nowMs: number): boolean {
  const entry = driftRefreshWindows.get(instanceId) ?? { timestamps: [] };
  pruneWindow(entry, nowMs);

  if (entry.timestamps.length >= DRIFT_REFRESH_RATE_LIMIT_MAX_REQUESTS) {
    driftRefreshWindows.set(instanceId, entry);
    return false;
  }

  entry.timestamps.push(nowMs);
  driftRefreshWindows.set(instanceId, entry);
  return true;
}

export function resetDriftRefreshRateLimitForTests(): void {
  driftRefreshWindows.clear();
}
