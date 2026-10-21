/**
 * Pure helpers for the live-events client: reconnect backoff, probe classification and
 * defensive parsing of SSE `data:` payloads. No `$app/*` or `svelte` imports so Deno tests can load it.
 */
import { LIVE_EVENT_TYPES, type LiveEvent, type LiveHelloEvent } from '$shared/events/types.ts';

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_JITTER = 0.2;
const RETRY_AFTER_MAX_MS = 300_000;

/** Exponential backoff 1 s → 30 s with ±20 % jitter, never below 1 s (decision 7). */
export function nextBackoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  const jitter = base * BACKOFF_JITTER * (random() * 2 - 1);
  return Math.max(BACKOFF_BASE_MS, Math.round(base + jitter));
}

/** Parses a `Retry-After` header given in integer seconds, capped at 5 minutes. */
export function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  if (!Number.isSafeInteger(seconds)) return null;
  return Math.min(RETRY_AFTER_MAX_MS, seconds * 1_000);
}

/** Maps a probe response status to the reconnect action (decision 6: auth failures stop). */
export function classifyProbeStatus(status: number): 'ok' | 'stop' | 'backoff' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'stop';
  return 'backoff';
}

type HelloHead = Pick<LiveHelloEvent, 'bootId' | 'headId'>;

/** The cursor a `hello` resets to: its head id, or `${bootId}-0` before anything was published. */
export function helloCursor(hello: HelloHead): string {
  return hello.headId || `${hello.bootId}-0`;
}

/**
 * Cursor after a `hello`: keeps the current one only when it belongs to the same server boot,
 * otherwise resets to the hello head so a restart does not resync on every reconnect.
 */
export function cursorAfterHello(current: string | null, hello: HelloHead): string {
  if (current !== null) {
    const dash = current.lastIndexOf('-');
    if (dash > 0 && current.slice(0, dash) === hello.bootId) return current;
  }
  return helloCursor(hello);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Parses one SSE payload. Unknown or malformed events return `null` (forward compatible). */
export function parseLiveEvent(raw: string): LiveEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) return null;
  const type = value.type;
  if (typeof type !== 'string' || !(LIVE_EVENT_TYPES as readonly string[]).includes(type)) return null;

  if (type.startsWith('job.')) {
    if (
      typeof value.jobId !== 'number' ||
      typeof value.jobType !== 'string' ||
      typeof value.source !== 'string' ||
      typeof value.displayName !== 'string'
    ) {
      return null;
    }
  }
  if (type === 'sync.recorded' && typeof value.syncHistoryId !== 'number') return null;

  return value as unknown as LiveEvent;
}
