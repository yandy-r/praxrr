import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { logTrashGuideRouteError, mapReadErrorStatus, parseSourceId, toErrorMessage } from '../_helpers.ts';

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

export const POST: RequestHandler = async ({ params }) => {
  const sourceIdResult = parseSourceId(params.id);
  if ('error' in sourceIdResult) {
    return json({ error: sourceIdResult.error }, { status: 400 });
  }

  const sourceId = sourceIdResult.value;

  try {
    // Guard to ensure the requested source exists before queuing work.
    trashGuideManager.getSource(sourceId);
  } catch (error) {
    const status = mapReadErrorStatus(error);
    if (status >= 500) {
      await logTrashGuideRouteError(error, `Failed to validate TRaSH source id=${sourceId} before sync`);
    }
    return json({ error: toErrorMessage(error) }, { status });
  }

  try {
    const result = enqueueManualTrashGuideSourceSync(sourceId);
    if (result.status === 'already_running') {
      return json(
        {
          error: 'TRaSH sync is already running for this source',
          run: result.run,
        },
        { status: 409 }
      );
    }

    return json({
      success: true,
      queued: true,
      job: result.job,
    });
  } catch (error) {
    await logTrashGuideRouteError(error, `Failed to enqueue TRaSH source sync id=${sourceId}`);
    return json({ error: toErrorMessage(error) }, { status: 500 });
  }
};

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
