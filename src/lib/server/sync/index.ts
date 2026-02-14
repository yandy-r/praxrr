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

// Syncer implementations
export { QualityProfileSyncer } from './qualityProfiles/index.ts';
export { DelayProfileSyncer } from './delayProfiles/index.ts';
export { MediaManagementSyncer } from './mediaManagement/index.ts';

// Custom formats (helper used by quality profiles)
export { syncCustomFormats } from './customFormats/index.ts';

// Processor functions
export { processPendingSyncs, syncInstance, triggerSyncs } from './processor.ts';

// Utilities
export { calculateNextRun, recoverInterruptedSyncs } from './utils.ts';
