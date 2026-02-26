import { jobQueueQueries, type CreateJobQueueInput } from '$db/queries/jobQueue.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import { jobDispatcher } from './dispatcher.ts';

/**
 * Creates a new job queue entry and immediately notifies the dispatcher.
 *
 * @param input - Job creation parameters
 * @returns The created job queue record
 * @throws {Error} If the record cannot be retrieved after creation
 */
export function enqueueJob(input: CreateJobQueueInput): JobQueueRecord {
  const id = jobQueueQueries.create(input);
  const record = jobQueueQueries.getById(id);
  if (!record) {
    throw new Error('Failed to enqueue job');
  }
  jobDispatcher.notifyJobEnqueued(record.runAt);
  return record;
}

/**
 * Upserts a scheduled job (creates or updates by dedupe key) and notifies the dispatcher.
 *
 * @param input - Job creation/update parameters including dedupe key and run time
 * @returns The upserted job queue record
 */
export function upsertScheduledJob(input: CreateJobQueueInput): JobQueueRecord {
  const record = jobQueueQueries.upsertScheduled(input);
  jobDispatcher.notifyJobEnqueued(record.runAt);
  return record;
}
