/**
 * Sync module - handles syncing PCD profiles to arr instances
 *
 * Used by:
 * - Sync job (automatic, triggered by should_sync flag)
 * - Manual sync (Sync Now button)
 */

// Types (consolidated in types.ts)
export type {
  SyncResult,
  ProcessSyncsResult,
  InstanceSyncResult,
  SectionType,
  SectionHandler,
  ScheduledConfig,
  SyncTriggerEvent,
  TriggerContext,
} from './types.ts';

// Base class
export { BaseSyncer } from './base.ts';

// Registry
export { getSection, getAllSections, getAllSectionTypes, hasSection, registerSection } from './registry.ts';
export { getConfiguredSections, resolveSectionsForInstance, hasConfiguredSection } from './registry.ts';

// Syncer implementations
export { QualityProfileSyncer } from './qualityProfiles/index.ts';
export { DelayProfileSyncer } from './delayProfiles/index.ts';
export { MediaManagementSyncer } from './mediaManagement/index.ts';

// Custom formats (helper used by quality profiles)
export { syncCustomFormats } from './customFormats/index.ts';

// Processor functions
export { processPendingSyncs, syncInstance, triggerSyncs } from './processor.ts';

// Preview
export {
  SyncPreviewStore,
  previewStore,
  type SyncPreviewStoreApi,
  DEFAULT_PREVIEW_TTL_MS,
  derivePreviewStatus,
  isPreviewExpired,
  PREVIEW_STATUS_GENERATING,
  PREVIEW_STATUS_READY,
  PREVIEW_STATUS_APPLYING,
  PREVIEW_STATUS_APPLIED,
  PREVIEW_STATUS_FAILED,
  PREVIEW_STATUS_EXPIRED,
  PREVIEW_STATUS_TRANSITIONS,
  type SyncPreviewCreateInput,
  type SyncPreviewUpdatePatch,
} from './preview/store.ts';

export type {
  SyncPreviewStatus,
  SyncPreviewAction,
  SyncPreviewFieldChangeType,
  SyncPreviewSection,
  SyncPreviewSectionMetadata,
  SyncPreviewSectionResult,
  SyncPreviewSectionOutcome,
  SyncPreviewSummary,
  SyncPreviewArrType,
  SyncPreviewResult,
  QualityProfilesPreview,
  DelayProfilesPreview,
  MediaManagementPreview,
  MetadataProfilesPreview,
  FieldChange,
  EntityChange,
} from './preview/types.ts';

// Utilities
export { calculateNextRun, recoverInterruptedSyncs } from './utils.ts';
