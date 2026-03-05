import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';

const PCD_SYNC_DEDUPE_KEY_PREFIX = 'pcd.sync:';

export interface PcdSyncQueuedJob {
  id: number;
  status: string;
  runAt: string;
  source: string;
  attempts: number;
}

export type EnqueueManualPcdSyncResult =
  | {
      status: 'already_running';
      job: PcdSyncQueuedJob;
    }
  | {
      status: 'queued';
      job: PcdSyncQueuedJob;
    };

function getDedupeKey(databaseId: number): string {
  return `${PCD_SYNC_DEDUPE_KEY_PREFIX}${databaseId}`;
}

function toQueuedJob(queueId: number): PcdSyncQueuedJob {
  const queue = jobQueueQueries.getById(queueId);
  if (!queue) {
    throw new Error(`PCD sync queue record missing while resolving queue metadata. queueId=${queueId}`);
  }

  return {
    id: queue.id,
    status: queue.status,
    runAt: queue.runAt,
    source: queue.source,
    attempts: queue.attempts,
  };
}

export function enqueueManualPcdSync(databaseId: number): EnqueueManualPcdSyncResult {
  const dedupeKey = getDedupeKey(databaseId);
  const existing = jobQueueQueries.getByDedupeKey(dedupeKey);
  if (existing?.status === 'running') {
    return {
      status: 'already_running',
      job: toQueuedJob(existing.id),
    };
  }

  const requestedAt = new Date().toISOString();
  const job = jobQueueQueries.upsertScheduled({
    jobType: 'pcd.sync',
    runAt: requestedAt,
    payload: {
      databaseId,
    },
    source: 'manual',
    dedupeKey,
  });

  if (job.status === 'running') {
    return {
      status: 'already_running',
      job: toQueuedJob(job.id),
    };
  }

  jobDispatcher.notifyJobEnqueued(job.runAt);

  return {
    status: 'queued',
    job: toQueuedJob(job.id),
  };
}
