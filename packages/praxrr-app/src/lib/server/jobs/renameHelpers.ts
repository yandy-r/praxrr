import { jobQueueQueries } from '$db/queries/jobQueue.ts';

export function cancelQueuedRenameJobs(instanceId: number): void {
  jobQueueQueries.cancelByDedupeKey(`arr.rename:${instanceId}`);

  const jobs = jobQueueQueries.listQueuedByJobTypeAndInstanceId('arr.rename', instanceId);
  for (const job of jobs) {
    jobQueueQueries.setStatus(job.id, 'cancelled');
  }
}
