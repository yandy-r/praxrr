/**
 * Canary sync / blast-radius types
 * Shared contracts for the canary rollout lifecycle: a rollout is scoped to
 * exactly one `arr_type` (no sibling fallback) and orchestrates the existing
 * per-instance sync primitive `executeSyncJob` behind a verification gate.
 */

import type { SyncPreviewArrType } from '$sync/preview/types.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type { SectionType } from '$sync/types.ts';
import type { JobHandlerResult, JobRunStatus } from '$jobs/queueTypes.ts';

// =============================================================================
// STATUS UNIONS
// =============================================================================

/** Arr types a canary rollout can target — mirrors sync-preview eligibility. */
export type CanaryArrType = SyncPreviewArrType; // 'radarr' | 'sonarr' | 'lidarr'

/** Lifecycle status of a `canary_rollouts` row. */
export type CanaryRolloutStatus =
  'canary_running' | 'awaiting_confirmation' | 'rolling_out' | 'completed' | 'aborted' | 'failed';

/** Classified outcome of the canary sync itself. */
export type CanaryOutcomeStatus = 'success' | 'partial' | 'failed' | 'skipped';

/** How a `partial` canary outcome is treated at the gate. */
export type CanaryPartialPolicy = 'gate' | 'abort';

/** What initiated the rollout. */
export type CanaryTrigger = 'manual' | 'system' | 'schedule';

// =============================================================================
// TARGET + RESULT SHAPES
// =============================================================================

/** A single instance participating in a rollout (canary or remaining). */
export interface CanaryTarget {
  instanceId: number;
  instanceName: string;
}

/** Outcome of syncing one remaining instance during rollout. */
export interface CanaryInstanceResult {
  instanceId: number;
  instanceName: string;
  status: JobRunStatus;
  output?: string;
  error?: string;
}

/**
 * `executeSyncJob`'s return contract. Aliased to the canonical {@link JobHandlerResult}
 * discriminated union so it can never drift from the primitive: a failure carries a typed
 * `failureCode` (no free-form `error`), matching the safe-evidence model (issue #237).
 */
export type SyncRunResult = JobHandlerResult;

// =============================================================================
// ROW SHAPES (byte-aligned to the migration columns)
// =============================================================================

/** Row shape for `canary_rollouts`. */
export interface CanaryRolloutRow {
  id: number;
  arr_type: string;
  status: string;
  canary_instance_id: number | null;
  canary_instance_name: string;
  canary_status: string | null;
  canary_sync_history_id: number | null;
  sections: string | null;
  max_batch_size: number;
  partial_policy: string;
  canary_output: string | null;
  canary_error: string | null;
  remaining_targets: string;
  batch_cursor: number;
  rollout_results: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  state_token: string;
  created_at: string;
  updated_at: string;
}

/** Row shape for the `canary_settings` singleton (id = 1). */
export interface CanarySettingsRow {
  id: number;
  enabled: number;
  default_max_batch_size: number;
  auto_select: number;
  default_canary_instance_id: number | null;
  default_partial_policy: string;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// DTOs (parsed, camelCase)
// =============================================================================

/**
 * Parsed, camelCased list-row summary. Heavy blobs and the `state_token` are NOT
 * exposed; `remainingCount`/`completedCount` are derived from array lengths.
 */
export interface CanaryRolloutSummary {
  id: number;
  arrType: CanaryArrType;
  status: CanaryRolloutStatus;
  canaryInstanceId: number | null;
  canaryInstanceName: string;
  canaryStatus: CanaryOutcomeStatus | null;
  maxBatchSize: number;
  partialPolicy: CanaryPartialPolicy;
  remainingCount: number;
  completedCount: number;
  trigger: CanaryTrigger;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full detail — every field including decoded blobs and the current `state_token`. */
export interface CanaryRolloutDetail {
  id: number;
  arrType: CanaryArrType;
  status: CanaryRolloutStatus;
  canaryInstanceId: number | null;
  canaryInstanceName: string;
  canaryStatus: CanaryOutcomeStatus | null;
  canarySyncHistoryId: number | null;
  sections: SectionType[] | null;
  maxBatchSize: number;
  partialPolicy: CanaryPartialPolicy;
  canaryOutput: string | null;
  canaryError: string | null;
  remainingTargets: CanaryTarget[];
  batchCursor: number;
  rolloutResults: CanaryInstanceResult[];
  trigger: CanaryTrigger;
  startedAt: string;
  finishedAt: string | null;
  stateToken: string;
  createdAt: string;
  updatedAt: string;
}

/** Parsed `canary_settings` singleton — `enabled`/`autoSelect` as booleans. */
export interface CanarySettings {
  enabled: boolean;
  defaultMaxBatchSize: number;
  autoSelect: boolean;
  defaultCanaryInstanceId: number | null;
  defaultPartialPolicy: CanaryPartialPolicy;
  updatedAt: string;
}

// =============================================================================
// COORDINATOR + SELECTION SURFACE
// =============================================================================

/**
 * Input to `startRollout`. `arrType` is the resolved rollout scope; the canary and
 * every remaining target resolve within this cohort only (no sibling fallback).
 */
export interface CanaryStartInput {
  arrType: CanaryArrType;
  canaryInstanceId?: number;
  sections?: SectionType[];
  maxBatchSize?: number;
  partialPolicy?: CanaryPartialPolicy;
  trigger?: CanaryTrigger;
}

/**
 * Successful resolution of the canary and its same-`arr_type` remaining cohort,
 * with defaults (batch size, partial policy) already applied.
 */
export interface CanaryResolution {
  arrType: CanaryArrType;
  canary: CanaryTarget;
  remaining: CanaryTarget[];
  sections: SectionType[] | null;
  maxBatchSize: number;
  partialPolicy: CanaryPartialPolicy;
  trigger: CanaryTrigger;
}

/**
 * Result of `startRollout`. Discriminated on `skipped`: single-eligible-target
 * auto-skips to a normal sync; otherwise the rollout halts at the gate with the
 * live preview of the remaining instances.
 */
export type CanaryStartResult =
  | { skipped: true; result: SyncRunResult }
  | { skipped: false; rollout: CanaryRolloutDetail; remainingPreview: GeneratePreviewResult[] };
