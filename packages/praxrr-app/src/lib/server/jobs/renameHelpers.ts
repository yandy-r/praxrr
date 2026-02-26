import { jobQueueQueries } from '$db/queries/jobQueue.ts';

/**
 * Cancels all queued rename jobs for the given Arr instance.
 *
 * @param instanceId - The Arr instance ID whose rename jobs should be cancelled
 */
export function cancelQueuedRenameJobs(instanceId: number): void {
  jobQueueQueries.cancelByDedupeKey(`arr.rename:${instanceId}`);

  const jobs = jobQueueQueries.listQueuedByJobTypeAndInstanceId('arr.rename', instanceId);
  for (const job of jobs) {
    jobQueueQueries.setStatus(job.id, 'cancelled');
  }
}
