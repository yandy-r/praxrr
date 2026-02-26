import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';

const TRASHGUIDE_SYNC_DEDUPE_KEY_PREFIX = 'trashguide.sync:';

export interface TrashGuideSyncRunMetadata {
  queueId: number;
  current: {
    status: string;
    runAt: string;
    startedAt: string | null;
    attempts: number;
    source: string;
  };
  latestRun: {
    id: number;
    status: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error: string | null;
    output: string | null;
  } | null;
}

export interface TrashGuideSyncQueuedJob {
  id: number;
  status: string;
  runAt: string;
  source: string;
  attempts: number;
}

export type EnqueueManualTrashGuideSyncResult =
  | {
      status: 'already_running';
      run: TrashGuideSyncRunMetadata;
    }
  | {
      status: 'queued';
      job: TrashGuideSyncQueuedJob;
    };

function getDedupeKey(sourceId: number): string {
  return `${TRASHGUIDE_SYNC_DEDUPE_KEY_PREFIX}${sourceId}`;
}

function toRunMetadata(queueId: number): TrashGuideSyncRunMetadata {
  const queue = jobQueueQueries.getById(queueId);
  if (!queue) {
    throw new Error(`TRaSH sync queue record missing while resolving run metadata. queueId=${queueId}`);
  }

  const latestRun = jobRunHistoryQueries.getByQueueId(queueId, 1)[0];

  return {
    queueId: queue.id,
    current: {
      status: queue.status,
      runAt: queue.runAt,
      startedAt: queue.startedAt,
      attempts: queue.attempts,
      source: queue.source,
    },
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
          durationMs: latestRun.durationMs,
          error: latestRun.error,
          output: latestRun.output,
        }
      : null,
  };
}

/**
 * Enqueues a manual TRaSH Guide source sync job.
 * If a sync is already running for the source, returns its run metadata instead.
 *
 * @param sourceId - The TRaSH Guide source ID to sync
 * @returns Result indicating whether the job was queued or already running
 */
export function enqueueManualTrashGuideSourceSync(sourceId: number): EnqueueManualTrashGuideSyncResult {
  const dedupeKey = getDedupeKey(sourceId);
  const existing = jobQueueQueries.getByDedupeKey(dedupeKey);
  if (existing?.status === 'running') {
    return {
      status: 'already_running',
      run: toRunMetadata(existing.id),
    };
  }

  const requestedAt = new Date().toISOString();
  const job = jobQueueQueries.upsertScheduled({
    jobType: 'trashguide.sync',
    runAt: requestedAt,
    payload: {
      sourceId,
      trigger: 'manual',
      requestedAt,
    },
    source: 'manual',
    dedupeKey,
  });

  if (job.status === 'running') {
    return {
      status: 'already_running',
      run: toRunMetadata(job.id),
    };
  }

  jobDispatcher.notifyJobEnqueued(job.runAt);

  return {
    status: 'queued',
    job: {
      id: job.id,
      status: job.status,
      runAt: job.runAt,
      source: job.source,
      attempts: job.attempts,
    },
  };
}
