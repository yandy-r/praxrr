/**
 * Sync History / Audit Trail (issue #17) — shared service-layer contracts.
 *
 * Sync history records one durable, append-only audit entry per Arr sync run
 * (per instance): timestamp, trigger, target instance, per-section outcomes,
 * entity change detail (before/after), success/partial/failure status, error, and
 * timing. It is the operational sibling of Drift Detection (#15) and reuses the
 * same {@link EntityChange}/{@link FieldChange} diff shapes.
 *
 * Diff direction (load-bearing — never invert): `FieldChange.current` is the live
 * (old) Arr value, `FieldChange.desired` is the PCD (new) value. Identical to
 * drift and the sync preview engine.
 */

import type { EntityChange, FieldChange, SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';
import type { SyncEntityOutcome } from '$sync/types.ts';

export type { EntityChange, FieldChange, SyncPreviewArrType, SyncPreviewSection };
export type { SyncEntityOutcome };

/** How the sync run was initiated. Maps from the job's `source`. */
export type SyncTrigger = 'manual' | 'schedule' | 'system';

/**
 * Finer-grained event behind a `system` trigger (pull vs change). Reserved for a
 * follow-up; persisted as NULL in this PR (no `processor.ts` plumbing yet).
 */
export type SyncTriggerEvent = 'on_pull' | 'on_change';

/** Terminal status of an audited sync run (no `cancelled` — see design §0 R2). */
export type SyncOperationStatus = 'success' | 'partial' | 'failed' | 'skipped';

/** Per-section outcome captured from each section's `SyncResult`. */
export interface SyncSectionResult {
  section: SyncPreviewSection;
  status: 'success' | 'failed' | 'skipped';
  itemsSynced: number;
  error: string | null;
  failedProfiles?: string[];
}

/**
 * A single entity change, tagged with the section + sub-collection it belongs to.
 * `EntityChange` (entityType/name/action/remoteId/fields) is reused verbatim from
 * the preview engine; `category` distinguishes sibling collections within a
 * section (e.g. `customFormats` vs `qualityProfiles`, `naming` vs `mediaSettings`).
 */
export interface SyncEntityChange extends EntityChange {
  section: SyncPreviewSection;
  category: string;
}

/** Input to the never-throwing recorder ({@link recordSyncHistory}). */
export interface SyncHistoryInput {
  arrInstanceId: number;
  instanceName: string;
  arrType: SyncPreviewArrType;
  jobId: number | null;
  trigger: SyncTrigger;
  triggerEvent: SyncTriggerEvent | null;
  sectionsAttempted: SyncPreviewSection[];
  status: SyncOperationStatus;
  sectionsRun: number;
  itemsSynced: number;
  failureCount: number;
  sectionResults: SyncSectionResult[];
  changes: SyncEntityChange[];
  /** Confirmed per-entity outcomes captured from the actual Arr writes (issue #232). */
  entityOutcomes: SyncEntityOutcome[];
  /** The reviewed sync preview this run applied, when known (plan↔run correlation). */
  previewId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}
