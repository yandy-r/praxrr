import type { TrashGuideSupportedArrType } from '$shared/trashguide/types.ts';

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
  /**
   * Correlation token minted at enqueue and preserved across dedupe-coalesced triggers (issue #238).
   * Exists during queued/running (in the queue payload) before any run-history row is created, so the
   * initiating surface can link to exactly one run by id rather than by timestamp matching.
   */
  runToken?: string;
  /** Durable source-identity snapshot so a since-deleted/disabled source stays identifiable (#238). */
  sourceName?: string;
  sourceArrType?: TrashGuideSupportedArrType;
}

/** Closed, safe vocabulary of manual/scheduled TRaSH sync failure reasons (issue #238). */
export type TrashGuideSyncFailureCode =
  | 'source_missing'
  | 'source_disabled'
  | 'network'
  | 'parser_failed'
  | 'sync_failed'
  | 'internal';

/**
 * Typed, closed, SAFE failure evidence for a TRaSH sync run.
 *
 * `message`/`recoveryAction` are pre-authored safe copy — they never contain raw exception text,
 * git/parser diagnostics, credentials, or hostnames. Mirrors `SyncPreviewFailureReason`.
 */
export interface TrashGuideSyncFailureReason {
  readonly code: TrashGuideSyncFailureCode;
  readonly message: string;
  readonly recoveryAction: string;
}

/** Fetched/applied counts carried in terminal TRaSH sync evidence. */
export interface TrashGuideSyncCounts {
  commitsBehind: number;
  parsedFiles: number;
  failedFiles: number;
  activeOperations: number;
  removedEntities: number;
  renamedEntities: number;
}

/**
 * Versioned, structured terminal evidence for one TRaSH sync run (issue #238), serialized into
 * `job_run_history.output`. `job_run_history` has no FK to the source, so this snapshot survives a
 * source hard-delete. `status` reuses `JobRunStatus` to avoid a second spelling of terminal state.
 */
export interface TrashGuideSyncRunEvidence {
  schemaVersion: 1;
  runToken: string | null;
  source: { id: number; name: string | null; arrType: TrashGuideSupportedArrType | null };
  trigger: 'manual' | 'scheduled';
  requestedAt: string | null;
  status: JobRunStatus;
  counts: TrashGuideSyncCounts | null;
  failure: TrashGuideSyncFailureReason | null;
  retry: { rescheduleAt: string | null; retryable: boolean };
}

/**
 * The single wire view of a source's current queue slot + latest terminal run, built once by
 * `getTrashGuideSyncStatus` and reused by the POST response and the GET status resolver (issue #238).
 */
export interface TrashGuideSyncStatusView {
  sourceId: number;
  sourceName: string | null;
  arrType: TrashGuideSupportedArrType | null;
  queueId: number | null;
  current: {
    status: JobStatus;
    runAt: string;
    startedAt: string | null;
    attempts: number;
    runToken: string | null;
  } | null;
  latestRun: {
    id: number;
    status: JobRunStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    evidence: TrashGuideSyncRunEvidence | null;
  } | null;
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
