import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { publishJobsCancelled } from '$lib/server/events/publish.ts';
import type { JobQueueRecord, JobType } from './queueTypes.ts';

function readId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
}

function matchesPayloadId(job: JobQueueRecord, key: 'instanceId' | 'databaseId', id: number): boolean {
  const value = job.payload?.[key];
  return readId(value) === id;
}

/**
 * Deletes `jobs` and then publishes `job.finished` (cancelled) for the queued ones so other tabs
 * drop them. A deleted running row still gets its terminal event from the dispatcher.
 */
function deleteJobs(jobs: JobQueueRecord[]): number {
  const deleted = jobQueueQueries.deleteByIds(jobs.map((job) => job.id));
  publishJobsCancelled(jobs.filter((job) => job.status === 'queued'));
  return deleted;
}

export function cleanupJobsForArrInstance(instanceId: number): number {
  const jobTypes: JobType[] = [
    'arr.upgrade',
    'arr.rename',
    'arr.sync',
    'arr.sync.qualityProfiles',
    'arr.sync.delayProfiles',
    'arr.sync.mediaManagement',
    'arr.sync.metadataProfiles',
  ];

  const jobs = jobQueueQueries.listByJobTypes(jobTypes);
  return deleteJobs(jobs.filter((job) => matchesPayloadId(job, 'instanceId', instanceId)));
}

export function cleanupJobsForDatabase(databaseId: number): number {
  const jobs = jobQueueQueries.listByJobTypes(['pcd.sync']);
  return deleteJobs(jobs.filter((job) => matchesPayloadId(job, 'databaseId', databaseId)));
}
