/**
 * Sync module type definitions
 * Consolidates all sync infrastructure types
 */

import type { BaseArrClient } from '$arr/base.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { SyncPreviewArrType, SyncPreviewSectionResult } from './preview/types.ts';

// =============================================================================
// CONFIRMED ENTITY OUTCOMES (issue #232)
// =============================================================================

/**
 * The write that was attempted for an entity. Distinct from {@link SyncEntityOutcomeStatus}:
 * `action` is intent (what we tried to do), `status` is the terminal result of the Arr write.
 * `delete` is reserved for contract completeness; no section syncer currently emits it.
 */
export type SyncEntityAction = 'create' | 'update' | 'delete';

/**
 * Terminal status of a per-entity Arr write. Sourced ONLY from the Arr write result — never
 * from a preview `EntityChange`. `success` = the write resolved; `failed` = it threw;
 * `skipped` = the entity was intentionally not written (unsupported field/condition, absent
 * source config, unmapped quality).
 */
export type SyncEntityOutcomeStatus = 'success' | 'skipped' | 'failed';

/** The kind of entity a confirmed outcome describes. */
export type SyncOutcomeEntityType =
  | 'customFormat'
  | 'qualityProfile'
  | 'delayProfile'
  | 'metadataProfile'
  | 'naming'
  | 'mediaSettings'
  | 'qualityDefinitions';

/**
 * A confirmed, per-entity terminal outcome captured from an actual Arr write (issue #232).
 *
 * Exactly one is produced per attempted entity. Unlike the preview `EntityChange` (planned
 * intent), `status` here is proof of what the Arr instance actually did. `reason` is a
 * sanitized, user-facing string (never a raw Arr error body) for skipped/failed outcomes.
 */
export interface SyncEntityOutcome {
  /** The sync section this entity belongs to. */
  section: SectionType;
  /** The Arr type of the target instance — set explicitly by the syncer, never inferred. */
  arrType: SyncPreviewArrType;
  entityType: SyncOutcomeEntityType;
  /** Stable identity: the unsuffixed PCD name (or subsection label for singletons). */
  name: string;
  action: SyncEntityAction;
  /** Terminal status from the Arr write result. */
  status: SyncEntityOutcomeStatus;
  /** Remote entity id when known (as a string; bulk writes have none). */
  remoteId: string | null;
  /** Sanitized reason; non-null for skipped/failed, null for success. */
  reason: string | null;
}

// =============================================================================
// SYNC RESULT TYPES
// =============================================================================

/**
 * Result of a single sync operation
 */
export interface SyncResult {
  success: boolean;
  itemsSynced: number;
  error?: string;
  failedProfiles?: string[];
  /**
   * One confirmed terminal outcome per attempted entity (issue #232). Required so every
   * producer is forced to populate it (the compiler is the completeness check). Empty when
   * a section attempted no per-entity writes (whole-section skip).
   */
  outcomes: SyncEntityOutcome[];
}

/**
 * Result of processing all pending syncs
 */
export interface ProcessSyncsResult {
  totalSynced: number;
  results: InstanceSyncResult[];
}

/**
 * Sync results for a single arr instance
 */
export interface InstanceSyncResult {
  instanceId: number;
  instanceName: string;
  qualityProfiles?: SyncResult;
  delayProfiles?: SyncResult;
  mediaManagement?: SyncResult;
  metadataProfiles?: SyncResult;
}

// =============================================================================
// SECTION REGISTRY TYPES
// =============================================================================

/**
 * Supported sync section types
 */
export type SectionType = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles';

/**
 * Scheduled sync configuration
 */
export interface ScheduledConfig {
  instanceId: number;
  cron: string | null;
  nextRunAt: string | null;
}

/**
 * Section handler interface
 * Each section type implements this to provide section-specific operations
 */
export interface SectionHandler {
  readonly type: SectionType;

  // Flag operations (legacy - uses should_sync)
  setShouldSync(instanceId: number, value: boolean): void;
  setNextRunAt(instanceId: number, nextRunAt: string | null): void;

  // Status operations (new - uses sync_status)
  claimSync(instanceId: number): boolean;
  completeSync(instanceId: number): void;
  failSync(instanceId: number, error: string): void;
  setStatusPending(instanceId: number): void;

  // Query operations
  getPendingInstanceIds(): number[];
  getScheduledConfigs(): ScheduledConfig[];

  // Syncer factory
  createSyncer(client: BaseArrClient, instance: ArrInstance): BaseSyncer;

  // Config check - returns true if this section has something to sync for the instance
  hasConfig(instanceId: number): boolean;
}

// =============================================================================
// EVENT TRIGGER TYPES
// =============================================================================

/**
 * Events that can trigger a sync
 */
export type SyncTriggerEvent = 'on_pull' | 'on_change';

/**
 * Context for a sync trigger
 */
export interface TriggerContext {
  event: SyncTriggerEvent;
  databaseId?: number;
}

// =============================================================================
// BASE SYNCER (forward declaration for type reference)
// =============================================================================

/**
 * Abstract base syncer interface
 * Actual implementation is in base.ts
 */
export interface BaseSyncer {
  sync(): Promise<SyncResult>;
  generatePreview(): Promise<Readonly<SyncPreviewSectionResult>>;
  setPreviewConfig(previewConfig: unknown): void;
  clearPreviewConfig(): void;
}
