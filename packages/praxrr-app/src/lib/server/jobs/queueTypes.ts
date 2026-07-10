import type { JobFailureCode, SafeJobEvidence } from '$shared/jobs/evidence.ts';

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
  /** Correlates the run's confirmed outcomes back to the reviewed sync preview (issue #232). */
  previewId?: string;
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
  /** Safe, back-compat summary column (failure message for failed runs); prefer `evidence`. */
  error: string | null;
  /** Safe, back-compat summary column (output/decision preview); prefer `evidence`. */
  output: string | null;
  /**
   * Structured safe durable evidence (issue #237). `null` for legacy rows written before
   * the evidence contract existed — such rows must never be shown as validated evidence.
   */
  evidence: SafeJobEvidence | null;
  createdAt: string;
}

/**
 * What a job handler returns to the dispatcher. Discriminated by `status` so a `failure`
 * is unrepresentable without a typed {@link JobFailureCode}. There is intentionally NO
 * free-form `error` channel — raw exception text goes to the sanitized logger only, and
 * the dispatcher derives the safe durable {@link SafeJobEvidence} from this result via
 * `buildSafeJobEvidence`.
 */
export type JobHandlerResult =
  | {
      status: 'success' | 'skipped' | 'cancelled';
      /** Safe count/summary of what ran; bounded before persistence. */
      output?: string;
      /** Human-readable subject name; falls back to the per-JobType descriptor when omitted. */
      target?: string | null;
      /** Short safe decision/skip/cancel summary; bounded before persistence. */
      decision?: string;
      rescheduleAt?: string | null;
    }
  | {
      status: 'failure';
      /** Typed, closed failure reason; drives the pre-authored safe message + recovery copy. */
      failureCode: JobFailureCode;
      output?: string;
      target?: string | null;
      decision?: string;
      /** Optional static recovery override; omit to use the code's pre-authored default. */
      recovery?: string;
      rescheduleAt?: string | null;
    };

export type JobHandler = (job: JobQueueRecord) => Promise<JobHandlerResult>;
