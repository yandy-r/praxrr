import type { RequestHandler } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { eventConnections } from '$lib/server/events/connections.ts';
import { resolveLastEventId } from '$lib/server/events/sse.ts';
import { createEventStream } from '$lib/server/events/stream.ts';
import { buildRevalidator, principalKey } from '$lib/server/events/streamAuth.ts';
import { LIVE_RETRY_AFTER_SECONDS } from '$shared/events/types.ts';

/**
 * GET /api/v1/events — live job/sync events as Server-Sent Events.
 * HEAD /api/v1/events — auth + capacity probe without opening a stream.
 *
 * Auth is enforced by the central hook (this route is NOT in PUBLIC_PATHS). The handler takes one
 * connection slot and has no other side effects.
 */

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

const REJECT_BODIES = {
  401: { error: 'Unauthorized' },
  429: { error: 'Too many event streams' },
  503: { error: 'Event stream capacity reached' },
} as const;

function reject(status: 401 | 429 | 503): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (status !== 401) {
    headers['Retry-After'] = String(LIVE_RETRY_AFTER_SECONDS);
  }
  return new Response(JSON.stringify(REJECT_BODIES[status]), { status, headers });
}

export const GET: RequestHandler = (event) => {
  const key = principalKey(event.locals);
  if (!key) {
    return reject(401);
  }
  const slot = eventConnections.acquire(key);
  if (!slot.ok) {
    void logger.warn('Live event stream rejected', { source: 'LiveEventStream', meta: { status: slot.status } });
    return reject(slot.status);
  }
  const stream = createEventStream({
    signal: event.request.signal,
    lastEventId: resolveLastEventId(event.request, event.url),
    revalidate: buildRevalidator(event.locals),
    release: slot.release,
  });
  return new Response(stream, { headers: SSE_HEADERS });
};

export const HEAD: RequestHandler = (event) => {
  const key = principalKey(event.locals);
  if (!key) {
    return reject(401);
  }
  const verdict = eventConnections.check(key);
  if (!verdict.ok) {
    return reject(verdict.status);
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
