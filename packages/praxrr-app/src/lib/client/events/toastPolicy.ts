/**
 * Pure toast policy for `job.finished` live events: which events toast, coalescing of repeated
 * background failures, and run-level dedupe. Copy uses only the server-built `displayName` and fixed
 * words; server `failureCode` text is never interpolated.
 */
import { SYNC_FAMILY_JOB_TYPES, type LiveJobFinishedEvent } from '$shared/events/types.ts';
import type { SyncOperationStatus } from '$sync/syncHistory/types.ts';

export type ToastDecision =
  | { kind: 'none' }
  | {
      kind: 'toast';
      type: 'success' | 'warning' | 'error' | 'info';
      message: string;
      sticky: boolean;
      href: string;
    };

export interface JobToastContext {
  syncHistoryId: number | null;
  syncStatus: SyncOperationStatus | null;
  base: string;
}

const NONE: ToastDecision = { kind: 'none' };

export function decideJobToast(e: LiveJobFinishedEvent, ctx: JobToastContext): ToastDecision {
  // Scheduled runs always come back rescheduled, even on failure; only non-failures stay quiet.
  if (e.rescheduled && e.runStatus !== 'failure') return NONE;

  const href =
    ctx.syncHistoryId !== null ? `${ctx.base}/sync-history/${ctx.syncHistoryId}` : `${ctx.base}/settings/jobs`;
  const name = e.displayName;
  const manual = e.source === 'manual';
  const syncFamily = SYNC_FAMILY_JOB_TYPES.includes(e.jobType);

  // A partial sync reports runStatus 'failure'; surface it as a warning rather than an error.
  if (ctx.syncStatus === 'partial' && (manual || (syncFamily && e.runStatus === 'failure'))) {
    return { kind: 'toast', type: 'warning', message: `${name} partially succeeded`, sticky: false, href };
  }

  if (manual) {
    switch (e.runStatus) {
      case 'success':
        return { kind: 'toast', type: 'success', message: `${name} finished`, sticky: false, href };
      case 'failure':
        return { kind: 'toast', type: 'error', message: `${name} failed`, sticky: true, href };
      case 'skipped':
        return { kind: 'toast', type: 'info', message: `${name} skipped`, sticky: false, href };
      case 'cancelled':
        return { kind: 'toast', type: 'info', message: `${name} cancelled`, sticky: false, href };
      default:
        return NONE;
    }
  }

  if (e.runStatus === 'failure' && syncFamily) {
    return { kind: 'toast', type: 'error', message: `${name} failed`, sticky: true, href };
  }
  return NONE;
}

const COALESCER_MAX_KEYS = 200;

/** Identity of a background failure stream: one job type against one instance and database. */
export function coalesceKey(e: LiveJobFinishedEvent): string {
  return `${e.jobType}:${e.instanceId ?? 'none'}:${e.databaseId ?? 'none'}`;
}

/** True for failures that are coalesced and replace each other's toast instead of stacking. */
export function isBackgroundFailure(e: LiveJobFinishedEvent): boolean {
  return e.source !== 'manual' && e.runStatus === 'failure';
}

/** Suppresses repeated background failure toasts for the same job type, instance and database. */
export class ToastCoalescer {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  allow(e: LiveJobFinishedEvent): boolean {
    if (!isBackgroundFailure(e)) return true;

    const key = coalesceKey(e);
    const at = this.now();
    const last = this.seen.get(key);
    if (last !== undefined && at - last < this.windowMs) return false;

    this.seen.delete(key);
    this.seen.set(key, at);
    while (this.seen.size > COALESCER_MAX_KEYS) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }
}

/** Bounded FIFO set used to dedupe events by `${jobId}:${runId}`. */
export class SeenSet {
  private readonly keys = new Set<string>();

  constructor(private readonly max = 500) {}

  addOnce(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    while (this.keys.size > this.max) {
      const oldest = this.keys.values().next().value;
      if (oldest === undefined) break;
      this.keys.delete(oldest);
    }
    return true;
  }
}
