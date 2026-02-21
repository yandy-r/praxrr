export const PREVIEW_REQUEST_BODY_LIMIT_BYTES = 64 * 1024;
export const PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS = 6;
export const PREVIEW_MAX_SNAPSHOTS = 200;

interface RateWindowEntry {
  timestamps: number[];
}

const createPreviewRateWindows = new Map<number, RateWindowEntry>();

function pruneWindow(entry: RateWindowEntry, nowMs: number): void {
  const windowStart = nowMs - PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS;
  entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > windowStart);
}

export function registerPreviewCreateAttempt(instanceId: number, nowMs: number): boolean {
  const entry = createPreviewRateWindows.get(instanceId) ?? { timestamps: [] };
  pruneWindow(entry, nowMs);

  if (entry.timestamps.length >= PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS) {
    createPreviewRateWindows.set(instanceId, entry);
    return false;
  }

  entry.timestamps.push(nowMs);
  createPreviewRateWindows.set(instanceId, entry);
  return true;
}

export function resetPreviewCreateRateLimitForTests(): void {
  createPreviewRateWindows.clear();
}
