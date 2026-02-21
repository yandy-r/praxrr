export type JobType =
  | 'arr.upgrade'
  | 'arr.rename'
  | 'arr.sync'
  | 'arr.sync.qualityProfiles'
  | 'arr.sync.delayProfiles'
  | 'arr.sync.mediaManagement'
  | 'arr.sync.metadataProfiles'
  | 'arr.pull.startup'
  | 'pcd.sync'
  | 'backup.create'
  | 'backup.cleanup'
  | 'logs.cleanup';

export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export type JobSource = 'schedule' | 'manual' | 'system';

export type JobRunStatus = 'success' | 'failure' | 'skipped' | 'cancelled';

export interface JobQueueRecord {
  id: number;
  jobType: JobType;
  status: JobStatus;
  runAt: string;
  payload: Record<string, unknown>;
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
  skipped_default: number;
  skipped_no_match: number;
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
