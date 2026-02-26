import { jobQueueQueries } from '$db/queries/jobQueue.ts';
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
 * Removes queued Arr-related jobs for the given instance from the job queue.
 *
 * @param instanceId - The Arr instance ID whose jobs should be removed
 * @returns Number of jobs deleted
 */
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
  const ids = jobs.filter((job) => matchesPayloadId(job, 'instanceId', instanceId)).map((job) => job.id);
  return jobQueueQueries.deleteByIds(ids);
}

/**
 * Removes queued PCD sync jobs for the given database instance from the job queue.
 *
 * @param databaseId - The database instance ID whose jobs should be removed
 * @returns Number of jobs deleted
 */
export function cleanupJobsForDatabase(databaseId: number): number {
  const jobs = jobQueueQueries.listByJobTypes(['pcd.sync']);
  const ids = jobs.filter((job) => matchesPayloadId(job, 'databaseId', databaseId)).map((job) => job.id);
  return jobQueueQueries.deleteByIds(ids);
}
