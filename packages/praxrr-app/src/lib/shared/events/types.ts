/**
 * Live event contract shared by the SSE server (`/api/v1/events`) and the browser client.
 * Type-only imports keep this module importable from Deno tests and the browser.
 * Mirrors `docs/api/v1/schemas/events.yaml`.
 */
import type { JobRunStatus, JobSource, JobStatus, JobType } from '$jobs/queueTypes.ts';
import type { JobFailureCode } from '$shared/jobs/evidence.ts';
import type { SyncOperationStatus, SyncTrigger } from '$sync/syncHistory/types.ts';
import type { CanaryOutcomeStatus, CanaryRolloutStatus } from '$sync/canary/types.ts';
import type { DriftStatus } from '$sync/drift/types.ts';
import type { SyncPreviewArrType } from '$sync/preview/types.ts';

export type LiveArrType = SyncPreviewArrType;

export const LIVE_EVENT_TYPES = [
  'hello',
  'resync',
  'job.queued',
  'job.running',
  'job.finished',
  'sync.recorded',
  'canary.updated',
  'drift.updated',
  'session.expired',
] as const;

export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface LiveJobEventBase {
  jobId: number;
  jobType: JobType;
  source: JobSource;
  displayName: string;
  instanceId: number | null;
  arrType: LiveArrType | null;
  databaseId: number | null;
}

export interface LiveHelloEvent {
  type: 'hello';
  bootId: string;
  /** Latest event id when the stream opens, or `''` when nothing has been published yet. */
  headId: string;
  serverTime: string;
  heartbeatMs: number;
}

export interface LiveResyncEvent {
  type: 'resync';
  reason: 'boot' | 'gap';
}

export interface LiveJobQueuedEvent extends LiveJobEventBase {
  type: 'job.queued';
  runAt: string;
}

export interface LiveJobRunningEvent extends LiveJobEventBase {
  type: 'job.running';
  startedAt: string;
}

export interface LiveJobFinishedEvent extends LiveJobEventBase {
  type: 'job.finished';
  status: JobStatus;
  runStatus: JobRunStatus;
  rescheduled: boolean;
  nextRunAt: string | null;
  runId: number;
  failureCode: JobFailureCode | null;
  durationMs: number;
  finishedAt: string;
}

export interface LiveSyncRecordedEvent {
  type: 'sync.recorded';
  syncHistoryId: number;
  jobId: number | null;
  instanceId: number;
  arrType: LiveArrType;
  status: SyncOperationStatus;
  trigger: SyncTrigger;
  finishedAt: string;
}

export interface LiveCanaryUpdatedEvent {
  type: 'canary.updated';
  rolloutId: number;
  arrType: LiveArrType;
  status: CanaryRolloutStatus;
  canaryStatus: CanaryOutcomeStatus | null;
  completedCount: number;
  remainingCount: number;
}

export interface LiveDriftUpdatedEvent {
  type: 'drift.updated';
  instanceId: number;
  arrType: LiveArrType;
  status: DriftStatus;
  driftedCount: number;
  missingCount: number;
  unmanagedCount: number;
  checkedAt: string;
}

export interface LiveSessionExpiredEvent {
  type: 'session.expired';
}

export type LiveEvent =
  | LiveHelloEvent
  | LiveResyncEvent
  | LiveJobQueuedEvent
  | LiveJobRunningEvent
  | LiveJobFinishedEvent
  | LiveSyncRecordedEvent
  | LiveCanaryUpdatedEvent
  | LiveDriftUpdatedEvent
  | LiveSessionExpiredEvent;

export type LiveEventOf<T extends LiveEventType> = Extract<LiveEvent, { type: T }>;

/** Events that carry an `id:` and are kept in the replay buffer. */
export type LiveDomainEvent = Exclude<LiveEvent, LiveHelloEvent | LiveResyncEvent | LiveSessionExpiredEvent>;

export const LIVE_HEARTBEAT_MS = 20_000;
export const LIVE_MAX_STREAM_MS = 60 * 60_000;
export const LIVE_RETRY_MS = 5_000;
export const LIVE_REPLAY_BUFFER = 256;
export const LIVE_MAX_STREAMS_PER_PRINCIPAL = 8;
export const LIVE_MAX_STREAMS_GLOBAL = 100;
export const LIVE_STREAM_QUEUE_HWM = 64;
export const LIVE_RETRY_AFTER_SECONDS = 30;
export const LIVE_EVENTS_PATH = '/api/v1/events';

export const LIVE_DEPENDENCY_KEYS = {
  jobs: 'praxrr:jobs',
  sync: 'praxrr:sync',
  syncHistory: 'praxrr:sync-history',
  canary: 'praxrr:canary',
  drift: 'praxrr:drift',
} as const;

export const SYNC_FAMILY_JOB_TYPES: readonly JobType[] = [
  'arr.sync',
  'arr.sync.qualityProfiles',
  'arr.sync.delayProfiles',
  'arr.sync.mediaManagement',
  'arr.sync.metadataProfiles',
  'pcd.sync',
  'trashguide.sync',
  'sync.canary.rollout',
];
