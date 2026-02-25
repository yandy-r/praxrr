import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { mapReadErrorStatus, parseSourceId, toErrorMessage } from '../_helpers.ts';

const TRASHGUIDE_SYNC_DEDUPE_KEY_PREFIX = 'trashguide.sync:';

export const POST: RequestHandler = ({ params }) => {
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
    return json({ error: toErrorMessage(error) }, { status });
  }

  try {
    const dedupeKey = `${TRASHGUIDE_SYNC_DEDUPE_KEY_PREFIX}${sourceId}`;
    const existing = jobQueueQueries.getByDedupeKey(dedupeKey);
    if (existing?.status === 'running') {
      return json(
        {
          error: 'TRaSH sync is already running for this source',
          run: toRunMetadata(existing.id),
        },
        { status: 409 }
      );
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
      return json(
        {
          error: 'TRaSH sync is already running for this source',
          run: toRunMetadata(job.id),
        },
        { status: 409 }
      );
    }

    jobDispatcher.notifyJobEnqueued(job.runAt);

    return json({
      success: true,
      queued: true,
      job: {
        id: job.id,
        status: job.status,
        runAt: job.runAt,
        source: job.source,
        attempts: job.attempts,
      },
    });
  } catch (error) {
    return json({ error: toErrorMessage(error) }, { status: 500 });
  }
};

function toRunMetadata(queueId: number): {
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
} {
  const queue = jobQueueQueries.getById(queueId);
  if (!queue) {
    return {
      queueId,
      current: {
        status: 'unknown',
        runAt: new Date().toISOString(),
        startedAt: null,
        attempts: 0,
        source: 'system',
      },
      latestRun: null,
    };
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
