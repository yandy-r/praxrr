/**
 * Pure Server-Sent Events frame encoding and `Last-Event-ID` parsing.
 *
 * Event payloads are serialized with `JSON.stringify`, which escapes newlines inside values, so a
 * payload can never terminate its own `data:` line and inject an extra frame.
 */
import type { LiveEvent } from '$shared/events/types.ts';

const encoder = new TextEncoder();

const EVENT_ID_PATTERN = /^([a-z0-9]{1,16})-(\d{1,15})$/;
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

/** Parses a `<bootId>-<seq>` event id. Returns `null` for anything malformed. */
export function parseEventId(raw: string | null): { bootId: string; seq: number } | null {
  if (raw === null) {
    return null;
  }
  const match = EVENT_ID_PATTERN.exec(raw.trim());
  if (!match) {
    return null;
  }
  return { bootId: match[1], seq: Number(match[2]) };
}

/**
 * Returns the resume point: the `Last-Event-ID` header, else the `lastEventId` query parameter,
 * else `null`. Values longer than 64 characters are ignored.
 */
export function resolveLastEventId(request: Request, url: URL): string | null {
  const candidates = [request.headers.get('Last-Event-ID'), url.searchParams.get('lastEventId')];
  for (const value of candidates) {
    if (value !== null && value.length <= MAX_LAST_EVENT_ID_LENGTH) {
      return value;
    }
  }
  return null;
}
