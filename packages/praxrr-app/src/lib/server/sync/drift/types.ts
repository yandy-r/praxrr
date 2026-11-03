/**
 * Drift detection types
 *
 * Drift detection is a scheduled/on-demand consumer of the sync preview engine
 * (`generatePreview`) that persists the resulting `EntityChange[]` as a latest-state,
 * one-row-per-instance drift record. These types describe the drift service surface;
 * the persisted DB row shapes live co-located in `$db/queries/driftStatus.ts`.
 *
 * See docs/plans/drift-detection/design.md.
 */

import type { FieldChange, SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';

/**
 * Stored per-instance drift status. `never-checked` is a summary-only synthesized value
 * for instances with no row yet and is NOT part of this stored union.
 */
export type DriftStatus = 'in-sync' | 'drifted' | 'unreachable' | 'unauthorized' | 'error';

/**
 * Sanitized closed reason union. `not_configured`/`cache_not_ready`/`rate_limited` are
 * normal degraded outcomes, never surfaced as raw error text and never mapped to a 500.
 */
export type DriftReason =
  | 'unreachable'
  | 'timeout'
  | 'unauthorized'
  | 'invalid_response'
  | 'not_configured'
  | 'cache_not_ready'
  | 'rate_limited'
  | 'error';

/**
 * How an `EntityChange.action` is classified for drift:
 * - `drift`     (action `update`)  — a managed entity whose fields diverged on the Arr (ALERTING)
 * - `missing`   (action `create`)  — a managed entity absent on the Arr (ALERTING)
 * - `unmanaged` (action `delete`)  — a live Arr entity not owned by Praxrr (NON-ALERTING)
 * - `prune`     (managed `delete`) — a ledger-owned entity pending reviewed removal (NON-ALERTING)
 */
export type DriftCategory = 'drift' | 'missing' | 'unmanaged' | 'prune';

/**
 * One non-`unchanged` entity difference, persisted verbatim in the `changes` JSON blob.
 * `fields` is stored exactly as `EntityChange.fields` — `current` = LIVE (old), `desired`
 * = PCD (new). This direction is load-bearing and must never be inverted.
 */
export interface DriftEntityChange {
  readonly section: SyncPreviewSection;
  readonly entityType: string;
  readonly name: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly category: DriftCategory;
  readonly remoteId: number | null;
  readonly fields: readonly FieldChange[];
}

/** Per-category drift counts rolled up from `DriftEntityChange[]`. */
export interface DriftCounts {
  readonly drifted: number;
  readonly missing: number;
  readonly unmanaged: number;
  readonly prune: number;
}

/**
 * Result of one drift check for a single instance. `checkInstanceDrift` never throws and
 * always returns this with a `status`, even on failure.
 */
export interface InstanceDriftResult {
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: SyncPreviewArrType;
  readonly status: DriftStatus;
  readonly reason: DriftReason | null;
  readonly detectedVersion: string | null;
  readonly counts: DriftCounts;
  /** update + create + delete entities (never `unchanged`). */
  readonly changes: readonly DriftEntityChange[];
  /** Hash over alerting (update+create) changes only; `null` when there is no alerting drift. */
  readonly driftSignature: string | null;
  /** ISO-8601 UTC of this cycle (always advances). */
  readonly checkedAt: string;
  /** ISO-8601 UTC of the last SUCCESSFUL section diff (unchanged on a failed check). */
  readonly contentCheckedAt: string | null;
  readonly durationMs: number;
}

/** Discriminated heartbeat outcome from a short-timeout `getSystemStatus` probe. */
export type HeartbeatResult =
  | { readonly ok: true; readonly version: string; readonly appName?: string }
  | { readonly ok: false; readonly status?: number };

// ============================================================================
// DRIFT REMEDIATION (reconcile / acknowledge+snooze / auto) — docs/plans/drift-remediation
// ============================================================================

/** Per-instance remediation policy. No stored row == `off` (default off, no backfill). */
export type DriftRemediationMode = 'off' | 'notify' | 'auto';

/** What initiated a drift remediation: a human Reconcile or the opt-in auto job. */
export type DriftRemediationTrigger = 'reconcile' | 'auto';

/** Terminal outcome of the last remediation attempt recorded on the drift row. */
export type DriftRemediationStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'held_canary';

/** Derived suppression overlay; the stored drift `status` is never rewritten. */
export type DriftSuppressionState = 'none' | 'acknowledged' | 'snoozed' | 'partially_acknowledged';

/**
 * One stored per-entity acknowledgement: the entity key plus the content fingerprint
 * (`driftEntityFingerprint`: key + field diff) reviewed at ack time. Active only while the
 * current change for that key still has the same fingerprint.
 */
export interface DriftEntityAck {
  readonly key: string;
  readonly fingerprint: string;
}

export interface DriftSuppression {
  readonly state: DriftSuppressionState;
  /** Active instance ack: the content signature (`driftContentSignature`) it covers, else null. */
  readonly acknowledgedSignature: string | null;
  readonly acknowledgedAt: string | null;
  /** Keys of the ACTIVE entity acks (content still matches the acknowledged fingerprint). */
  readonly acknowledgedEntityKeys: readonly string[];
  /** Only set while the snooze is still in the future. */
  readonly snoozedUntil: string | null;
  /** Alerting (drift+missing) changes NOT covered by an ack/snooze. */
  readonly effectiveDrifted: number;
  readonly effectiveMissing: number;
  /** Hash over un-acked alerting keys; null when nothing alerts. */
  readonly effectiveSignature: string | null;
}

export interface DriftRemediationPolicy {
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly mode: DriftRemediationMode;
  readonly allowedSections: readonly SyncPreviewSection[];
  /** null => synthesized default (no stored row). */
  readonly updatedAt: string | null;
}

export interface DriftRemediationRecord {
  readonly trigger: DriftRemediationTrigger | null;
  readonly status: DriftRemediationStatus | null;
  readonly signature: string | null;
  readonly at: string | null;
  readonly syncHistoryId: number | null;
}

/** Server-owned link carried on a preview snapshot and into sync_history. */
export interface DriftRemediationLink {
  readonly instanceId: number;
  readonly driftSignature: string;
  readonly driftDetectedAt: string | null;
  readonly trigger: DriftRemediationTrigger;
}
