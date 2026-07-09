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
 * - `unmanaged` (action `delete`)  — a live Arr entity not in the resolved desired set (NON-ALERTING)
 */
export type DriftCategory = 'drift' | 'missing' | 'unmanaged';

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
