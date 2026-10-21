/**
 * Bridges `job.finished` live events to `alertStore` toasts with a "View details" link. Correlates
 * the run with its `sync.recorded` history row (when one arrived first) and dedupes replays.
 */
import { base } from '$app/paths';
import { alertStore } from '$alerts/store';
import { eventsStore } from '$stores/events';
import {
  coalesceKey,
  decideJobToast,
  isBackgroundFailure,
  SeenSet,
  ToastCoalescer,
} from '$lib/client/events/toastPolicy.ts';
import type { SyncOperationStatus } from '$sync/syncHistory/types.ts';

interface CorrelatedHistory {
  id: number;
  status: SyncOperationStatus;
}

const HISTORY_BY_JOB_MAX = 200;

export function startJobToasts(): () => void {
  const historyByJob = new Map<number, CorrelatedHistory>();
  const seen = new SeenSet();
  const coalescer = new ToastCoalescer();

  const offRecorded = eventsStore.on('sync.recorded', (e) => {
    if (e.jobId === null) return;
    historyByJob.delete(e.jobId);
    historyByJob.set(e.jobId, { id: e.syncHistoryId, status: e.status });
    while (historyByJob.size > HISTORY_BY_JOB_MAX) {
      const oldest = historyByJob.keys().next().value;
      if (oldest === undefined) break;
      historyByJob.delete(oldest);
    }
  });

  // A new run of a reused (scheduled) jobId must never inherit the previous run's history row.
  const offRunning = eventsStore.on('job.running', (e) => {
    historyByJob.delete(e.jobId);
  });

  const offFinished = eventsStore.on('job.finished', (e) => {
    // A replayed `job.finished` after reconnect must toast exactly once.
    if (!seen.addOnce(`${e.jobId}:${e.runId}`)) return;
    const history = historyByJob.get(e.jobId);
    historyByJob.delete(e.jobId);
    const d = decideJobToast(e, {
      syncHistoryId: history?.id ?? null,
      syncStatus: history?.status ?? null,
      base,
    });
    if (d.kind === 'toast' && coalescer.allow(e)) {
      // Repeated background failures replace their previous sticky toast instead of stacking.
      alertStore.add(
        d.type,
        d.message,
        d.sticky ? 0 : undefined,
        { label: 'View details', href: d.href },
        { key: isBackgroundFailure(e) ? coalesceKey(e) : undefined }
      );
    }
  });

  return () => {
    offRecorded();
    offRunning();
    offFinished();
    historyByJob.clear();
  };
}
