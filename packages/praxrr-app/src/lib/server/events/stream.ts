/**
 * Builds one live-event SSE stream.
 *
 * The stream sends `retry:`, a `hello` frame, any replay (or a `resync`), then live bus events.
 * A heartbeat re-validates the caller's credential and sends a `: ping` comment; a lifetime timer
 * bounds the stream. Every exit path (abort, cancel, expiry, lifetime, slow consumer, enqueue
 * failure) funnels through one idempotent `close()` that unsubscribes, clears timers, releases the
 * connection slot exactly once and closes the controller.
 */
import { logger } from '$logger/logger.ts';
import { LIVE_HEARTBEAT_MS, LIVE_MAX_STREAM_MS, LIVE_RETRY_MS, LIVE_STREAM_QUEUE_HWM } from '$shared/events/types.ts';
import { type EventBus, eventBus } from './bus.ts';
import { encodeComment, encodeEvent, encodeRetry } from './sse.ts';

export interface EventStreamOptions {
  bus?: EventBus;
  signal: AbortSignal;
  lastEventId: string | null;
  revalidate: () => boolean;
  release: () => void;
  heartbeatMs?: number;
  maxLifetimeMs?: number;
  highWaterMark?: number;
  now?: () => number;
}

type CloseReason = 'abort' | 'cancel' | 'expired' | 'lifetime' | 'slow-consumer' | 'enqueue-error' | 'start-error';

export function createEventStream(opts: EventStreamOptions): ReadableStream<Uint8Array> {
  const bus = opts.bus ?? eventBus;
  const heartbeatMs = opts.heartbeatMs ?? LIVE_HEARTBEAT_MS;
  const maxLifetimeMs = opts.maxLifetimeMs ?? LIVE_MAX_STREAM_MS;
  const now = opts.now ?? Date.now;
  const { signal, revalidate, release } = opts;

  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let unsubscribe: (() => void) | undefined;
  let stopTimers: (() => void) | undefined;
  const onAbort = (): void => close('abort');

  function close(reason: CloseReason): void {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe?.();
    stopTimers?.();
    signal.removeEventListener('abort', onAbort);
    release();
    try {
      controllerRef?.close();
    } catch {
      // Already closed or errored (e.g. cancelled by the consumer).
    }
    void logger.debug('Live event stream closed', { source: 'LiveEventStream', meta: { reason } });
  }

  function send(chunk: Uint8Array): void {
    if (closed || controllerRef === null) {
      return;
    }
    const desiredSize = controllerRef.desiredSize;
    if (desiredSize !== null && desiredSize <= 0) {
      close('slow-consumer');
      return;
    }
    try {
      controllerRef.enqueue(chunk);
    } catch {
      close('enqueue-error');
    }
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controllerRef = controller;
        try {
          send(encodeRetry(LIVE_RETRY_MS));
          send(
            encodeEvent({
              type: 'hello',
              bootId: bus.bootId,
              headId: bus.headId(),
              serverTime: new Date(now()).toISOString(),
              heartbeatMs,
            })
          );
          const replay = bus.replaySince(opts.lastEventId);
          if (replay.kind === 'resync') {
            send(encodeEvent({ type: 'resync', reason: replay.reason }));
          } else {
            for (const envelope of replay.events) {
              send(encodeEvent(envelope.event, envelope.id));
            }
          }
          if (closed) {
            return;
          }
          unsubscribe = bus.subscribe((envelope) => send(encodeEvent(envelope.event, envelope.id)));
          const heartbeat = setInterval(() => {
            if (!revalidate()) {
              send(encodeEvent({ type: 'session.expired' }));
              close('expired');
              return;
            }
            send(encodeComment('ping'));
          }, heartbeatMs);
          const lifetime = setTimeout(() => close('lifetime'), maxLifetimeMs);
          stopTimers = () => {
            clearInterval(heartbeat);
            clearTimeout(lifetime);
          };
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) {
            close('abort');
          }
        } catch {
          close('start-error');
        }
      },
      cancel() {
        close('cancel');
      },
    },
    new CountQueuingStrategy({ highWaterMark: opts.highWaterMark ?? LIVE_STREAM_QUEUE_HWM })
  );
}
