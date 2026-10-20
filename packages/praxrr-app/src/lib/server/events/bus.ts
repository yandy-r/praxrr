/**
 * In-process live event bus with a bounded replay ring.
 *
 * Publishers call `eventBus.publish(...)` after their DB write commits; SSE streams subscribe
 * and use `replaySince(Last-Event-ID)` to recover events missed during a reconnect. Event ids
 * are `${bootId}-${seq}` so a restarted process is detected as a `resync 'boot'`.
 */
import { logger } from '$logger/logger.ts';
import { LIVE_REPLAY_BUFFER, type LiveDomainEvent } from '$shared/events/types.ts';

export interface LiveEventEnvelope {
  id: string;
  seq: number;
  event: LiveDomainEvent;
}

export type ReplayResult = { kind: 'replay'; events: LiveEventEnvelope[] } | { kind: 'resync'; reason: 'boot' | 'gap' };

type LiveEventListener = (envelope: LiveEventEnvelope) => void;

/** Eight lowercase base36 characters from a CSPRNG. */
function randomBootId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = '';
  for (const byte of bytes) {
    id += (byte % 36).toString(36);
  }
  return id;
}

/**
 * Parses `${prefix}-${seq}`; returns null unless the suffix is a non-negative safe integer.
 * Seq `0` is the "nothing seen yet" cursor a client sends when `hello.headId` was empty.
 */
function parseId(raw: string): { prefix: string; seq: number } | null {
  const dash = raw.lastIndexOf('-');
  if (dash <= 0 || !/^\d+$/.test(raw.slice(dash + 1))) return null;
  const seq = Number(raw.slice(dash + 1));
  return Number.isSafeInteger(seq) && seq >= 0 ? { prefix: raw.slice(0, dash), seq } : null;
}

export class EventBus {
  readonly bootId: string;
  private seq = 0;
  private buffer: LiveEventEnvelope[] = [];
  private listeners = new Set<LiveEventListener>();

  constructor(
    private readonly capacity: number = LIVE_REPLAY_BUFFER,
    bootId: string = randomBootId()
  ) {
    this.bootId = bootId;
  }

  /** Fire-and-forget: never throws and never awaits. */
  publish(event: LiveDomainEvent): void {
    try {
      this.seq += 1;
      const envelope: LiveEventEnvelope = { id: `${this.bootId}-${this.seq}`, seq: this.seq, event };
      this.buffer.push(envelope);
      while (this.buffer.length > this.capacity) {
        this.buffer.shift();
      }
      for (const listener of this.listeners) {
        try {
          listener(envelope);
        } catch {
          void logger.warn('Live event listener failed', { source: 'LiveEvents', meta: { type: event.type } });
        }
      }
    } catch {
      void logger.error('Live event publish failed', { source: 'LiveEvents', meta: { type: event.type } });
    }
  }

  /** Registers a listener; the returned unsubscribe is idempotent. */
  subscribe(fn: LiveEventListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  subscriberCount(): number {
    return this.listeners.size;
  }

  /** Id of the latest published envelope, or `''` before the first publish. */
  headId(): string {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].id : '';
  }

  replaySince(lastEventId: string | null): ReplayResult {
    if (lastEventId === null || lastEventId === '') {
      return { kind: 'replay', events: [] };
    }
    const parsed = parseId(lastEventId);
    if (parsed === null || parsed.prefix !== this.bootId || parsed.seq > this.seq) {
      return { kind: 'resync', reason: 'boot' };
    }
    if (parsed.seq === this.seq) {
      return { kind: 'replay', events: [] };
    }
    const oldest = this.buffer[0];
    if (oldest === undefined || oldest.seq > parsed.seq + 1) {
      return { kind: 'resync', reason: 'gap' };
    }
    return { kind: 'replay', events: this.buffer.filter((envelope) => envelope.seq > parsed.seq) };
  }
}

const KEY = Symbol.for('praxrr.events.bus');
type G = typeof globalThis & { [KEY]?: EventBus };

/** Process-wide bus; kept on `globalThis` so Vite HMR reuses the same instance. */
export const eventBus: EventBus = ((globalThis as G)[KEY] ??= new EventBus());
