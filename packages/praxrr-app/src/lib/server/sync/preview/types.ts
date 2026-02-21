/**
 * Sync preview types
 * Shared contracts for preview lifecycle and diff payloads
 */

import type { ArrType } from '$arr/types.ts';

export type SyncPreviewStatus = 'generating' | 'ready' | 'applying' | 'applied' | 'failed' | 'expired';

export type SyncPreviewAction = 'create' | 'update' | 'delete' | 'unchanged';

export type SyncPreviewFieldChangeType = 'added' | 'changed' | 'removed';

export type SyncPreviewSection = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles';

/**
 * Arr type values supported by sync preview operations.
 *
 * This intentionally excludes placeholder/unsupported values from ArrType.
 */
export type SyncPreviewArrType = Exclude<ArrType, 'all' | 'chaptarr'>;

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
  | QualityProfilesPreview
  | DelayProfilesPreview
  | MediaManagementPreview
  | MetadataProfilesPreview;

export interface SyncPreviewSummary {
  readonly totalCreates: number;
  readonly totalUpdates: number;
  readonly totalDeletes: number;
  readonly totalUnchanged: number;
}

export interface SyncPreviewSectionOutcome {
  readonly section: SyncPreviewSection;
  readonly error: string | null;
  readonly skipped: boolean;
}

export interface SyncPreviewResult {
  readonly id: string;
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: SyncPreviewArrType;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: SyncPreviewStatus;
  readonly error?: string;
  readonly sections: readonly SyncPreviewSection[];
  readonly sectionOutcomes: readonly SyncPreviewSectionOutcome[];
  readonly qualityProfiles: QualityProfilesPreview | null;
  readonly delayProfiles: DelayProfilesPreview | null;
  readonly mediaManagement: MediaManagementPreview | null;
  readonly metadataProfiles: MetadataProfilesPreview | null;
  readonly summary: SyncPreviewSummary;
}
