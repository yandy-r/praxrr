/**
 * Caps concurrent live-event streams per principal and globally.
 *
 * Over the per-principal cap the caller rejects with 429 (decision 7); existing streams are never
 * evicted. Over the global cap the caller rejects with 503.
 */
import { LIVE_MAX_STREAMS_GLOBAL, LIVE_MAX_STREAMS_PER_PRINCIPAL } from '$shared/events/types.ts';

export type AcquireResult = { ok: true; release: () => void } | { ok: false; status: 429 | 503 };
export type CheckResult = { ok: true } | { ok: false; status: 429 | 503 };

export class EventConnectionRegistry {
  private byKey = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly perPrincipal: number = LIVE_MAX_STREAMS_PER_PRINCIPAL,
    private readonly global: number = LIVE_MAX_STREAMS_GLOBAL
  ) {}

  /** Reserves a slot for `key`. The returned `release` is idempotent. */
  acquire(key: string): AcquireResult {
    const verdict = this.check(key);
    if (!verdict.ok) {
      return verdict;
    }
    this.byKey.set(key, (this.byKey.get(key) ?? 0) + 1);
    this.total += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.total -= 1;
        const remaining = (this.byKey.get(key) ?? 1) - 1;
        if (remaining <= 0) {
          this.byKey.delete(key);
        } else {
          this.byKey.set(key, remaining);
        }
      },
    };
  }

  /** Applies the same cap tests as `acquire` without reserving a slot (used by HEAD). */
  check(key: string): CheckResult {
    if (this.total >= this.global) {
      return { ok: false, status: 503 };
    }
    if ((this.byKey.get(key) ?? 0) >= this.perPrincipal) {
      return { ok: false, status: 429 };
    }
    return { ok: true };
  }

  /** Open streams for `key`, or across all principals when `key` is omitted. */
  count(key?: string): number {
    return key === undefined ? this.total : (this.byKey.get(key) ?? 0);
  }
}

const REGISTRY_KEY = Symbol.for('praxrr.events.connections');
const registryHost = globalThis as typeof globalThis & { [REGISTRY_KEY]?: EventConnectionRegistry };

/** Process-wide registry, kept on `globalThis` so it survives HMR (decision 8). */
export const eventConnections: EventConnectionRegistry = (registryHost[REGISTRY_KEY] ??= new EventConnectionRegistry());
