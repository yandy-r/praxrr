/**
 * Pure Server-Sent Events frame encoding and `Last-Event-ID` parsing.
 *
 * Event payloads are serialized with `JSON.stringify`, which escapes newlines inside values, so a
 * payload can never terminate its own `data:` line and inject an extra frame.
 */
import type { LiveEvent } from '$shared/events/types.ts';

const encoder = new TextEncoder();

const MAX_LAST_EVENT_ID_LENGTH = 64;

/** Encodes the `retry:` field that sets the client's reconnection delay. */
export function encodeRetry(ms: number): Uint8Array {
  return encoder.encode(`retry: ${ms}\n\n`);
}

/** Encodes an SSE comment line, used as the heartbeat. */
export function encodeComment(text = 'ping'): Uint8Array {
  return encoder.encode(`: ${text}\n\n`);
}

/**
 * Encodes one event frame. The optional `id` becomes the `id:` field.
 * @throws TypeError when `id` contains a line break or NUL, which would corrupt the frame.
 */
export function encodeEvent(event: LiveEvent, id?: string): Uint8Array {
  if (id !== undefined && /[\n\r\0]/.test(id)) {
    throw new TypeError('SSE event id must not contain line breaks or NUL characters');
  }
  return encoder.encode(`${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Stands in for a supplied-but-unusable resume id. It never parses as `<bootId>-<seq>`, so
 * `EventBus.replaySince` answers `resync 'boot'` instead of the stream silently starting fresh.
 */
export const REJECTED_LAST_EVENT_ID = 'rejected';

/**
 * Resume point: the `Last-Event-ID` header, else the `lastEventId` query parameter, else `null`.
 * Values longer than 64 characters are not used; if every supplied value is too long the result is
 * {@link REJECTED_LAST_EVENT_ID} so the client is told to resync.
 */
export function resolveLastEventId(request: Request, url: URL): string | null {
  const candidates = [request.headers.get('Last-Event-ID'), url.searchParams.get('lastEventId')];
  let rejected = false;
  for (const value of candidates) {
    if (value === null) continue;
    if (value.length <= MAX_LAST_EVENT_ID_LENGTH) return value;
    rejected = true;
  }
  return rejected ? REJECTED_LAST_EVENT_ID : null;
}
