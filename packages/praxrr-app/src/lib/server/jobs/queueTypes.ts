/**
 * Ordered inventory of every queued workflow Praxrr can dispatch.
 *
 * Runtime consumers (including the transparency audit) use this tuple so the
 * compile-time union and runtime inventory cannot drift apart.
 */
export const JOB_TYPES = [
  'arr.upgrade',
  'arr.rename',
  'arr.sync',
  'arr.sync.qualityProfiles',
  'arr.sync.delayProfiles',
  'arr.sync.mediaManagement',
  'arr.sync.metadataProfiles',
  'arr.pull.startup',
  'pcd.sync',
  'trashguide.sync',
  'backup.create',
  'backup.cleanup',
  'logs.cleanup',
  'drift.check',
  'sync.history.cleanup',
  'sync.canary.rollout',
  'config-health.snapshot',
  'config-health.cleanup',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export type JobSource = 'schedule' | 'manual' | 'system';

export type JobRunStatus = 'success' | 'failure' | 'skipped' | 'cancelled';

export type ArrSyncSection = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles';

export interface ArrSyncJobPayload {
  instanceId: number;
  sections?: ArrSyncSection[];
  section?: ArrSyncSection;
}

export interface ArrSyncSectionJobPayload {
  instanceId: number;
}

export interface ArrRenameJobPayload {
  instanceId: number;
}

export interface ArrUpgradeJobPayload {
  instanceId: number;
}

export interface PcdSyncJobPayload {
  databaseId: number;
}

export interface TrashGuideSyncJobPayload {
  sourceId: number;
  trigger: 'manual' | 'scheduled';
  requestedAt?: string;
}

export interface ArrPullStartupJobPayload {
  enqueuedAt?: string;
}

export type ArrSyncCleanupOnlyPayload = Record<string, never>;

/**
 * Payload for the global drift.check sweep. Empty `{}` starts a fresh sweep; the
 * continuation carries a cursor so a chunked sweep can resume without monopolizing the
 * single-flag serialized dispatcher.
 */
export interface DriftCheckJobPayload {
  sweepStartedAt?: string;
  cursor?: number;
}

export interface CanaryRolloutJobPayload {
  rolloutId: number;
}

export interface JobPayloadByType {
  'arr.sync': ArrSyncJobPayload;
  'arr.sync.qualityProfiles': ArrSyncSectionJobPayload;
  'arr.sync.delayProfiles': ArrSyncSectionJobPayload;
  'arr.sync.mediaManagement': ArrSyncSectionJobPayload;
  'arr.sync.metadataProfiles': ArrSyncSectionJobPayload;
  'arr.upgrade': ArrUpgradeJobPayload;
  'arr.rename': ArrRenameJobPayload;
  'pcd.sync': PcdSyncJobPayload;
  'trashguide.sync': TrashGuideSyncJobPayload;
  'arr.pull.startup': ArrPullStartupJobPayload;
  'backup.create': ArrSyncCleanupOnlyPayload;
  'backup.cleanup': ArrSyncCleanupOnlyPayload;
  'logs.cleanup': ArrSyncCleanupOnlyPayload;
  'drift.check': DriftCheckJobPayload;
  'sync.history.cleanup': ArrSyncCleanupOnlyPayload;
  'sync.canary.rollout': CanaryRolloutJobPayload;
  'config-health.snapshot': ArrSyncCleanupOnlyPayload;
  'config-health.cleanup': ArrSyncCleanupOnlyPayload;
}

export type JobPayload<T extends JobType = JobType> = T extends JobType ? JobPayloadByType[T] : never;

export type AnyJobPayload = JobPayloadByType[JobType];

export interface JobQueueRecord {
  id: number;
  jobType: JobType;
  status: JobStatus;
  runAt: string;
  payload: AnyJobPayload & Record<string, unknown>;
  source: JobSource;
  dedupeKey: string | null;
  cooldownUntil: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArrPullStartupCounters {
  imported: number;
  skippedDefault: number;
  skippedNoMatch: number;
  conflicted: number;
  failed: number;
}

// Keep run status aligned with JobRunStatus to avoid introducing a separate status model.
export interface ArrPullStartupInstanceResult extends ArrPullStartupCounters {
  instanceId: number;
  instanceName: string;
  status: JobRunStatus;
}

export interface ArrPullStartupRunResult extends ArrPullStartupCounters {
  runId: string;
  status: JobRunStatus;
  startedAt: string;
  finishedAt: string | null;
  instances: ArrPullStartupInstanceResult[];
}

export interface JobRunHistoryRecord {
  id: number;
  queueId: number | null;
  jobType: JobType;
  status: JobRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string | null;
  output: string | null;
  createdAt: string;
}

export interface JobHandlerResult {
  status: JobRunStatus;
  output?: string;
  error?: string;
  rescheduleAt?: string | null;
}

export type JobHandler = (job: JobQueueRecord) => Promise<JobHandlerResult>;
