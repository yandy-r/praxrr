/**
 * Sync preview types
 * Shared contracts for preview lifecycle and diff payloads
 */

import type { ArrType } from '$arr/types.ts';

export type SyncPreviewStatus = 'generating' | 'ready' | 'applying' | 'applied' | 'failed' | 'expired';

export type SyncPreviewAction = 'create' | 'update' | 'delete' | 'unchanged';

export type SyncPreviewFieldChangeType = 'added' | 'changed' | 'removed';

export type SyncPreviewSection = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles';

/** Private evidence classes captured while materializing a reviewed preview. */
export type SyncPreviewEvidenceClass = 'pcd' | 'arr';

/** Closed reasons why a reviewed binding cannot authorize execution. */
export type SyncPreviewReviewInvalidationReason =
  'pcd_drift' | 'arr_drift' | 'pcd_and_arr_drift' | 'scope_drift' | 'unverifiable_review';

/**
 * Closed vocabulary of Sync Preview generate/apply failure reasons.
 *
 * Every value is assigned by matching a thrown error's TYPE/status (never by parsing
 * message text), so no raw exception or secret-shaped string is ever transported to the
 * API response, the stored snapshot, or the UI. Full diagnostics stay only in the
 * sanitized logger. Kept in lockstep with `SyncPreviewFailureCode` in
 * `docs/api/v1/schemas/sync.yaml`.
 */
export type SyncPreviewFailureCode =
  | 'unreachable'
  | 'timeout'
  | 'unauthorized'
  | 'notFound'
  | 'rejected'
  | 'serverError'
  | 'sectionErrors'
  | 'executionFailed'
  | 'stale'
  | 'internalError';

/**
 * Typed, closed, safe failure evidence for Sync Preview generate/apply.
 *
 * `message` and `recoveryAction` are pre-authored safe copy — they never contain raw
 * exception text, Arr response bodies, credentials, hostnames, or stack traces.
 */
export interface SyncPreviewFailureReason {
  readonly code: SyncPreviewFailureCode;
  readonly message: string;
  readonly recoveryAction: string;
}

/**
 * Arr type values supported by sync preview operations.
 *
 * This intentionally excludes placeholder/unsupported values from ArrType.
 */
export type SyncPreviewArrType = Exclude<ArrType, 'all' | 'chaptarr'>;

/**
 * Narrows a loosely-typed instance `type` column to a sync-preview-capable arr type.
 * Shared so the sync-preview route, the drift service, and drift routes all gate identically
 * (excludes placeholder/unsupported `all`/`chaptarr`).
 */
export function isSyncPreviewArrType(value: string): value is SyncPreviewArrType {
  return value === 'radarr' || value === 'sonarr' || value === 'lidarr';
}

export interface SyncPreviewSectionMetadata {
  readonly section: SyncPreviewSection;
}

export interface FieldChange {
  readonly field: string;
  readonly type: SyncPreviewFieldChangeType;
  readonly current: unknown;
  readonly desired: unknown;
}

export interface EntityChange {
  readonly entityType: string;
  readonly name: string;
  readonly action: SyncPreviewAction;
  readonly remoteId: number | null;
  readonly fields: readonly FieldChange[];
}

export interface QualityProfilesPreview extends SyncPreviewSectionMetadata {
  readonly section: 'qualityProfiles';
  readonly customFormats: readonly EntityChange[];
  readonly qualityProfiles: readonly EntityChange[];
}

export interface DelayProfilesPreview extends SyncPreviewSectionMetadata {
  readonly section: 'delayProfiles';
  readonly profile: EntityChange | null;
}

export interface MediaManagementPreview extends SyncPreviewSectionMetadata {
  readonly section: 'mediaManagement';
  readonly naming: EntityChange | null;
  readonly qualityDefinitions: readonly EntityChange[];
  readonly mediaSettings: EntityChange | null;
}

export interface MetadataProfilesPreview extends SyncPreviewSectionMetadata {
  readonly section: 'metadataProfiles';
  readonly profile: EntityChange | null;
}

export type SyncPreviewSectionResult =
  QualityProfilesPreview | DelayProfilesPreview | MediaManagementPreview | MetadataProfilesPreview;

export interface SyncPreviewSummary {
  readonly totalCreates: number;
  readonly totalUpdates: number;
  readonly totalDeletes: number;
  readonly totalUnchanged: number;
}

export interface SyncPreviewSectionOutcome {
  readonly section: SyncPreviewSection;
  readonly failure: SyncPreviewFailureReason | null;
  readonly skipped: boolean;
}

/**
 * Exact values prepared by a section while producing a reviewed preview.
 *
 * `desired` is the validated Arr payload (or bounded group of payloads), `materialPlan`
 * contains any execution ordering/identity decisions that are not represented by the public
 * diff, and `currentGuards` contains the relevant current-value identities used to narrow the
 * validation-to-write race. Values are private, process-local, and must be structured-cloneable.
 */
export interface SyncPreviewPreparedExecutionContext {
  readonly section: SyncPreviewSection;
  readonly config: unknown;
  readonly desired: unknown;
  readonly materialPlan: unknown;
  readonly currentGuards: unknown;
}

/**
 * Optional private sink attached only while materializing a reviewed preview.
 *
 * Concrete syncers record bounded evidence beside their authoritative reads. Keys are
 * section-owned stable labels (for example `selectedProfile` or `remoteProfiles`), not
 * user-facing text. Duplicate keys fail closed in the orchestrator's recorder.
 */
export interface SyncPreviewEvidenceRecorder {
  record(section: SyncPreviewSection, source: SyncPreviewEvidenceClass, key: string, value: unknown): void;
  prepare(context: SyncPreviewPreparedExecutionContext): void;
}

/** Raw private evidence for one successfully materialized section. */
export interface SyncPreviewSectionMaterializedEvidence {
  readonly section: SyncPreviewSection;
  readonly pcd: unknown;
  readonly arr: unknown;
  readonly plan: unknown;
}

/**
 * Private companion to a generated public preview.
 *
 * This type must never be placed on {@link SyncPreviewResult} or returned by a GET/API route.
 * It exists for preview creation and apply-time revalidation only.
 */
export interface SyncPreviewReviewMaterialization {
  readonly sectionConfigs: Readonly<Partial<Record<SyncPreviewSection, unknown>>>;
  readonly evidence: readonly SyncPreviewSectionMaterializedEvidence[];
  readonly preparedExecutionContexts: Readonly<
    Partial<Record<SyncPreviewSection, SyncPreviewPreparedExecutionContext>>
  >;
}

/**
 * Private, per-section digests. Raw PCD, Arr, and material-plan evidence must never be
 * retained on this type or added to the public {@link SyncPreviewResult}.
 */
export interface SyncPreviewSectionEvidenceHash {
  readonly section: SyncPreviewSection;
  readonly pcdHash: string;
  readonly arrHash: string;
  readonly planHash: string;
}

/**
 * Process-local authorization evidence for a reviewed preview.
 *
 * This is deliberately not part of any public API result. The preview store owns it beside
 * (rather than inside) the public snapshot, so GET serialization cannot expose private hashes
 * or effective execution configuration accidentally.
 */
export interface SyncPreviewReviewBinding {
  readonly version: 1;
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly sections: readonly SyncPreviewSection[];
  readonly sectionConfigs: Readonly<Partial<Record<SyncPreviewSection, unknown>>>;
  readonly evidence: Readonly<Partial<Record<SyncPreviewSection, SyncPreviewSectionEvidenceHash>>>;
}

export type ReviewedEvidenceComparison =
  | { readonly kind: 'match' }
  | {
      readonly kind: 'invalidated';
      readonly reason: SyncPreviewReviewInvalidationReason;
      readonly changedEvidence: readonly SyncPreviewEvidenceClass[];
      readonly changedSections: readonly SyncPreviewSection[];
    };

export interface SyncPreviewResult {
  readonly id: string;
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: SyncPreviewArrType;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: SyncPreviewStatus;
  readonly failure: SyncPreviewFailureReason | null;
  readonly sections: readonly SyncPreviewSection[];
  readonly sectionOutcomes: readonly SyncPreviewSectionOutcome[];
  readonly qualityProfiles: QualityProfilesPreview | null;
  readonly delayProfiles: DelayProfilesPreview | null;
  readonly mediaManagement: MediaManagementPreview | null;
  readonly metadataProfiles: MetadataProfilesPreview | null;
  readonly summary: SyncPreviewSummary;
}
