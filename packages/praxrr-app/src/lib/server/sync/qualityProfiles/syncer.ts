/**
 * Quality profile syncer
 * Syncs quality profiles from PCD and TRaSH Guide sources to arr instances.
 *
 * Each database's CFs and QPs are synced with an invisible namespace suffix
 * so multiple databases can coexist in the same arr instance. TRaSH Guide profiles
 * are transformed and synced from source-aware TRaSH caches using the same
 * namespacing strategy.
 *
 * Sync order:
 * 1. Group sync selections by database, assign namespace suffixes
 * 2. For each database: sync its custom formats (suffixed) → build per-DB formatIdMap
 * 3. Refresh full CF list from arr → build allFormatIdMap
 * 4. Resolve TRaSH and PCD source batches
 * 5. For each source batch: sync quality profiles (suffixed) using the right lookup maps
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { SyncEntityOutcome } from '../types.ts';
import { sanitizeArrWriteError } from '../sanitizeArrWriteError.ts';
import { arrSyncQueries, type ProfileSelection } from '$db/queries/arrSync.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { type TrashGuideSyncQualityProfileSourceHydration, trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { getCache, getCachedDatabaseIds } from '$pcd/index.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import { recordConfirmedWrite } from '../ownership/record.ts';
import { executePrunes } from '../ownership/executePrunes.ts';
import { isSyncHistoryEnabled } from '../syncHistory/record.ts';
import type { PrunePlanItem } from '../ownership/planPrunes.ts';
import { blockedPrunesField, markManagedDeletes, planPreviewPrunes } from '../ownership/previewPrunes.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { type ArrManagedEntity, arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import { isPluginsEnabled, pluginHost } from '$server/plugins/index.ts';
import { buildCapabilityInput } from '$server/plugins/hostContext.ts';
import { getAllQualities, type SyncArrType } from '../mappings.ts';
import {
  getNamespaceSuffix,
  getTrailingNamespaceSuffix,
  getTrashGuideNamespaceSuffix,
  isTrashGuideNamespaceSuffix,
} from '../namespace.ts';
import {
  confirmTrashNamespace,
  planTrashNamespaces,
  resolveTrashSourceProfiles,
  type TrashNamespaceAssignment,
  type TrashSourceResolution,
} from '../trashSourceProfiles.ts';
import type {
  QualityProfilesPreview,
  SyncPreviewPreparedExecutionContext,
  SyncPreviewSectionResult,
} from '../preview/types.ts';
import type { PortableCustomFormat, PortableQualityProfile } from '$shared/pcd/portable.ts';
import { omitUndefinedReviewProperties } from '../preview/reviewBinding.ts';
import {
  CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES,
  diffEntityCollection,
  QUALITY_PROFILE_ARRAY_KEY_STRATEGIES,
} from '../preview/sectionDiffs.ts';

// Custom formats
import { previewCustomFormats, syncCustomFormats, writeCustomFormatPayload } from '../customFormats/syncer.ts';
import { fetchCustomFormatFromPcd } from '../customFormats/transformer.ts';
import type { PcdCustomFormat } from '../customFormats/transformer.ts';
import {
  fetchQualityProfileFromPcd,
  getQualityApiMappings,
  getReferencedCustomFormatNames,
  normalizeQualityProfileForPreview,
  type PcdQualityProfile,
  type QualityProfileComparableInput,
  transformQualityProfileWithSuffix,
} from './transformer.ts';
import type { ArrCustomFormat, ArrLanguage, ArrQualityProfilePayload } from '$arr/types.ts';

// Internal types for sync data
interface ProfileSyncData {
  pcdProfile: PcdQualityProfile;
  referencedFormatNames: string[];
}

interface QualityProfilesPreviewConfig {
  selections: ProfileSelection[];
}

/** Per-database batch of profiles and CFs to sync. */
interface DatabaseSyncBatch {
  sourceKind: 'pcd' | 'trash';
  sourceLabel: string;
  databaseId: number;
  suffix: string;
  profiles: ProfileSyncData[];
  customFormats: Map<string, PcdCustomFormat>;
  /** Populated after CF sync: PCD format name (unsuffixed) → arr ID */
  pcdFormatIdMap: Map<string, number>;
  /** TRaSH batches only: the namespace plan entry that produced `suffix`. */
  trashNamespace?: TrashNamespaceAssignment;
}

interface SyncedProfileSummary {
  name: string;
  action: 'created' | 'updated';
  language: string;
  cutoffFormatScore: number;
  minFormatScore: number;
  formats: { name: string; score: number }[];
}

interface PreviewComparableCustomFormat extends Record<string, unknown> {
  readonly name: string;
  readonly id?: number;
}

interface PreviewComparableQualityProfile extends Record<string, unknown> {
  readonly name: string;
  readonly id?: number;
  readonly items?: unknown;
  readonly language?: ArrLanguage;
  readonly upgradeAllowed?: boolean;
  readonly cutoff?: number;
  readonly minFormatScore?: number;
  readonly cutoffFormatScore?: number;
  readonly minUpgradeFormatScore?: number;
  readonly formatItems?: unknown;
}

interface PreviewFormatIdMapInput {
  readonly arrFormat: {
    readonly name: string;
    readonly id?: number;
  };
}

interface PreparedCustomFormatWrite {
  readonly pcdName: string;
  readonly payload: ArrCustomFormat;
}

interface PreparedQualityProfileWrite {
  readonly pcdName: string;
  readonly payload: ArrQualityProfilePayload;
  readonly remoteId: number | null;
}

interface PreparedQualityProfileBatch {
  readonly sourceKind: DatabaseSyncBatch['sourceKind'];
  readonly sourceLabel: string;
  readonly databaseId: number;
  readonly suffix: string;
  readonly trashNamespace?: TrashNamespaceAssignment;
  readonly customFormats: readonly PreparedCustomFormatWrite[];
  readonly qualityProfiles: readonly PreparedQualityProfileWrite[];
}

interface QualityProfilePayloadWriteResult {
  readonly remoteId: number | null;
  readonly summary: SyncedProfileSummary | null;
  readonly outcome: SyncEntityOutcome;
}

interface QualityProfilesPreparedExecutionContext extends SyncPreviewPreparedExecutionContext {
  readonly section: 'qualityProfiles';
  readonly config: QualityProfilesPreviewConfig;
  readonly desired: {
    readonly batches: readonly PreparedQualityProfileBatch[];
  };
  readonly materialPlan: {
    readonly arrType: SyncArrType;
    readonly batchOrder: readonly string[];
    readonly prunes: readonly PrunePlanItem[];
  };
  readonly currentGuards: {
    readonly customFormats: readonly ArrCustomFormat[];
    readonly qualityProfiles: readonly PreviewComparableQualityProfile[];
  };
}

function mapEntries<K, V>(map: ReadonlyMap<K, V>): readonly (readonly [K, V])[] {
  return [...map.entries()];
}

function projectBatchEvidence(batch: DatabaseSyncBatch): unknown {
  return omitUndefinedReviewProperties({
    sourceKind: batch.sourceKind,
    sourceLabel: batch.sourceLabel,
    databaseId: batch.databaseId,
    suffix: batch.suffix,
    profiles: batch.profiles.map(({ pcdProfile, referencedFormatNames }) => ({
      pcdProfile,
      referencedFormatNames,
    })),
    customFormats: mapEntries(batch.customFormats),
  });
}

function isQualityProfilesPreparedContext(
  context: Readonly<SyncPreviewPreparedExecutionContext>
): context is Readonly<QualityProfilesPreparedExecutionContext> {
  if (context.section !== 'qualityProfiles') {
    return false;
  }

  const materialPlan = context.materialPlan as Partial<QualityProfilesPreparedExecutionContext['materialPlan']>;
  const desired = context.desired as Partial<QualityProfilesPreparedExecutionContext['desired']>;
  return (
    (materialPlan.arrType === 'radarr' || materialPlan.arrType === 'sonarr' || materialPlan.arrType === 'lidarr') &&
    Array.isArray(materialPlan.batchOrder) &&
    Array.isArray(materialPlan.prunes) &&
    Array.isArray(desired.batches)
  );
}

export function mergePreviewFormatIdMap(
  existingMap: ReadonlyMap<string, number>,
  preparedFormats: readonly PreviewFormatIdMapInput[]
): Map<string, number> {
  const merged = new Map(existingMap);

  for (const prepared of preparedFormats) {
    if (typeof prepared.arrFormat.id !== 'number') {
      continue;
    }

    merged.set(prepared.arrFormat.name, prepared.arrFormat.id);
  }

  return merged;
}

function parsePositiveInteger(rawValue: unknown): number | null {
  if (typeof rawValue !== 'number') {
    return null;
  }

  return Number.isInteger(rawValue) ? rawValue : null;
}

function parseQualityProfileSelection(rawValue: unknown): ProfileSelection | null {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null;
  }

  const value = rawValue as Record<string, unknown>;
  const databaseId = parsePositiveInteger(value.databaseId);
  if (databaseId === null || databaseId <= 0) {
    return null;
  }

  if (typeof value.profileName !== 'string' || value.profileName.trim().length === 0) {
    return null;
  }

  return { databaseId, profileName: value.profileName };
}

function parseQualityProfileSelectionArray(rawSelections: unknown): ProfileSelection[] | null {
  if (!Array.isArray(rawSelections)) {
    return null;
  }

  const parsedSelections: ProfileSelection[] = [];
  for (const rawSelection of rawSelections) {
    const selection = parseQualityProfileSelection(rawSelection);
    if (!selection) {
      continue;
    }

    parsedSelections.push(selection);
  }

  return parsedSelections;
}

function parseQualityProfileSelectionMap(rawSelections: unknown): ProfileSelection[] | null {
  if (!rawSelections || typeof rawSelections !== 'object' || Array.isArray(rawSelections)) {
    return null;
  }

  const parsedSelections: ProfileSelection[] = [];
  for (const [rawDatabaseId, rawProfiles] of Object.entries(rawSelections as Record<string, unknown>)) {
    const databaseId = parseInt(rawDatabaseId, 10);
    if (!Number.isInteger(databaseId) || databaseId <= 0) {
      continue;
    }

    if (!rawProfiles || typeof rawProfiles !== 'object' || Array.isArray(rawProfiles)) {
      continue;
    }

    for (const [profileName, isSelected] of Object.entries(rawProfiles as Record<string, unknown>)) {
      if (isSelected === true) {
        parsedSelections.push({ databaseId, profileName });
      }
    }
  }

  return parsedSelections;
}

function parseQualityProfilesPreviewConfig(rawConfig: unknown): QualityProfilesPreviewConfig | null {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return null;
  }

  const root = rawConfig as Record<string, unknown>;
  const source = 'selections' in root ? root.selections : rawConfig;

  const selections = Array.isArray(source)
    ? parseQualityProfileSelectionArray(source)
    : parseQualityProfileSelectionMap(source);

  if (selections === null) {
    return null;
  }

  return {
    selections,
  };
}

export class QualityProfileSyncer extends BaseSyncer {
  private instanceType: SyncArrType;

  constructor(
    client: ConstructorParameters<typeof BaseSyncer>[0],
    instanceId: number,
    instanceName: string,
    instanceType: SyncArrType
  ) {
    super(client, instanceId, instanceName);
    this.instanceType = instanceType;
  }

  protected get syncType(): string {
    return 'quality profiles';
  }

  /**
   * Override sync to handle the complex quality profile sync flow
   */
  override async sync(): Promise<SyncResult> {
    const preparedContext = this.getPreparedExecutionContext();
    if (preparedContext) {
      if (!isQualityProfilesPreparedContext(preparedContext)) {
        return {
          success: false,
          itemsSynced: 0,
          error: 'Invalid reviewed quality profile execution context',
          outcomes: [],
        };
      }
      if (preparedContext.materialPlan.arrType !== this.instanceType) {
        return {
          success: false,
          itemsSynced: 0,
          error: `Reviewed quality profile plan targets ${preparedContext.materialPlan.arrType}, not ${this.instanceType}`,
          outcomes: [],
        };
      }

      return this.syncPreparedQualityProfiles(preparedContext);
    }

    // Confirmed per-entity outcomes (issue #232). Declared outside the try so a mid-sync throw
    // still returns whatever was captured before the failure (partials are never dropped).
    const outcomes: SyncEntityOutcome[] = [];
    try {
      await logger.info(`Starting quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: {
          instanceId: this.instanceId,
          instanceType: this.instanceType,
        },
      });

      // 1. Fetch profiles and CFs grouped by database (dropped selections → skipped outcomes)
      const batches = await this.fetchSyncBatches(outcomes, undefined, 'allocate');

      const totalProfiles = batches.reduce((sum, b) => sum + b.profiles.length, 0);
      if (totalProfiles === 0) {
        await logger.debug(`No quality profiles to sync for "${this.instanceName}"`, {
          source: 'Sync:QualityProfiles',
          meta: { instanceId: this.instanceId },
        });
        return { success: true, itemsSynced: 0, outcomes };
      }

      // 2. Sync custom formats per-database (each with its namespace suffix)
      for (const batch of batches) {
        const cfResult = await syncCustomFormats(
          this.client,
          this.instanceId,
          this.instanceType,
          batch.customFormats,
          batch.suffix,
          { sourceKind: batch.sourceKind, databaseId: batch.databaseId }
        );
        batch.pcdFormatIdMap = cfResult.pcdFormatIdMap;
        outcomes.push(...cfResult.outcomes);
      }

      // 3. Refresh full CF list from arr (all databases' suffixed CFs)
      const allArrFormats = await this.client.getCustomFormats();
      const allFormatIdMap = new Map(allArrFormats.map((f) => [f.name, f.id!]));

      // 4. Get quality API mappings (use first available database's cache)
      const qualityMappings = await this.getQualityMappings(batches);

      // 5. Sync quality profiles per-database
      const existingProfiles = await this.client.getQualityProfiles();
      const existingMap = new Map(existingProfiles.map((p) => [p.name, p.id]));

      const allSyncedProfiles: SyncedProfileSummary[] = [];
      const failedProfiles = new Set<string>();
      for (const batch of batches) {
        const synced = await this.syncQualityProfiles(
          batch.profiles,
          batch.suffix,
          batch.pcdFormatIdMap,
          allFormatIdMap,
          qualityMappings,
          existingMap,
          failedProfiles,
          outcomes,
          { sourceKind: batch.sourceKind, databaseId: batch.databaseId }
        );
        allSyncedProfiles.push(...synced);
      }

      if (failedProfiles.size > 0) {
        return {
          success: false,
          itemsSynced: allSyncedProfiles.length,
          failedProfiles: [...failedProfiles],
          error: `Failed to sync ${failedProfiles.size} quality profile(s)`,
          outcomes,
        };
      }

      await logger.info(`Completed quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: {
          instanceId: this.instanceId,
          databases: batches.length,
          profiles: allSyncedProfiles.map((p) => ({
            name: p.name,
            action: p.action,
            formats: p.formats.length,
          })),
        },
      });

      return { success: true, itemsSynced: allSyncedProfiles.length, outcomes };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await logger.error(`Failed quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: { instanceId: this.instanceId, error: errorMsg },
      });

      return { success: false, itemsSynced: 0, error: errorMsg, outcomes };
    }
  }

  /**
   * Generate a read-only preview diff for quality profiles.
   */
  override async generatePreview(): Promise<Readonly<SyncPreviewSectionResult>> {
    try {
      await logger.info(`Generating quality profile preview for "${this.instanceName}"`, {
        source: 'Preview:QualityProfiles',
        meta: {
          instanceId: this.instanceId,
          instanceType: this.instanceType,
        },
      });

      const effectiveConfig = this.getQualityProfilesSyncConfig();
      this.recordPreviewEvidence('qualityProfiles', 'pcd', 'effectiveConfig', effectiveConfig);
      // Read-only: TRaSH namespaces are predicted, never persisted, while previewing.
      const batches = await this.fetchSyncBatches(undefined, effectiveConfig, 'predict');
      if (this.hasPreviewReviewRecorder()) {
        this.recordPreviewEvidence('qualityProfiles', 'pcd', 'sourceBatches', batches.map(projectBatchEvidence));
      }
      const totalProfiles = batches.reduce((sum, batch) => sum + batch.profiles.length, 0);

      // Opt-in pruning policy is read fresh for every preview so a toggle takes effect on the next
      // review. Evidence binds both the policy and the ledger the plan was derived from.
      const pruneEnabled = arrInstancesQueries.isPruneRemovedManagedEnabled(this.instanceId);
      this.recordPreviewEvidence('qualityProfiles', 'pcd', 'pruneEnabled', pruneEnabled);
      const ledger = pruneEnabled ? arrManagedEntitiesQueries.listForInstance(this.instanceId) : [];
      if (pruneEnabled) {
        // Timestamps change on every confirmed write; only identity fields bind the review.
        this.recordPreviewEvidence(
          'qualityProfiles',
          'pcd',
          'managedLedger',
          ledger.map(({ entityType, remoteId, arrName, pcdName, databaseId, sourceKind }) => ({
            entityType,
            remoteId,
            arrName,
            pcdName,
            databaseId,
            sourceKind,
          }))
        );
      }
      const pruneLedger = pruneEnabled && ledger.length > 0 ? ledger : null;

      if (totalProfiles === 0) {
        if (pruneLedger) return await this.generateEmptySelectionPrunePreview(effectiveConfig, pruneLedger);
        this.preparePreviewExecution({
          section: 'qualityProfiles',
          config: effectiveConfig,
          desired: { batches: [] },
          materialPlan: { arrType: this.instanceType, batchOrder: [], prunes: [] },
          currentGuards: { customFormats: [], qualityProfiles: [] },
        });
        return {
          section: 'qualityProfiles',
          customFormats: [],
          qualityProfiles: [],
        };
      }

      const allArrCustomFormats = await this.client.getCustomFormats();
      this.recordPreviewEvidence('qualityProfiles', 'arr', 'customFormats', allArrCustomFormats);
      let allPreviewFormatIdMap = new Map(allArrCustomFormats.map((f) => [f.name, f.id!]));
      const allArrProfiles = await this.client.getQualityProfiles();
      this.recordPreviewEvidence('qualityProfiles', 'arr', 'qualityProfiles', allArrProfiles);
      const existingProfilesMap = new Map(allArrProfiles.map((p) => [p.name, p.id]));

      const qualityMappings = await this.getQualityMappings(batches);
      this.recordPreviewEvidence('qualityProfiles', 'pcd', 'qualityMappings', mapEntries(qualityMappings));
      this.recordPreviewEvidence('qualityProfiles', 'pcd', 'qualityCapabilities', {
        arrType: this.instanceType,
        qualities: getAllQualities(this.instanceType),
      });

      const desiredCustomFormats: ArrCustomFormat[] = [];
      const desiredProfiles: ArrQualityProfilePayload[] = [];
      const preparedBatches: PreparedQualityProfileBatch[] = [];
      /** Per-batch pcdFormatIdMap from first pass to avoid calling previewCustomFormats twice. */
      const batchPcdFormatIdMaps: Map<string, number>[] = [];
      const preparedCustomFormatsByBatch: PreparedCustomFormatWrite[][] = [];
      const capturedCustomFormatClient = {
        getCustomFormats: async () => allArrCustomFormats,
      } as unknown as BaseArrClient;

      // One running counter across batches: reviewed apply resolves formatItems by planned id,
      // so synthetic ids must be unique across the whole plan, not per batch.
      let nextSyntheticId = -1;
      for (const batch of batches) {
        const preview = await previewCustomFormats(
          capturedCustomFormatClient,
          this.instanceId,
          this.instanceType,
          batch.customFormats,
          batch.suffix,
          nextSyntheticId
        );
        const { preparedFormats, pcdFormatIdMap } = preview;
        nextSyntheticId = preview.nextSyntheticId;

        desiredCustomFormats.push(...preparedFormats.map((prepared) => prepared.arrFormat));
        preparedCustomFormatsByBatch.push(
          preparedFormats.map(({ pcdName, arrFormat }) => ({
            pcdName,
            payload: arrFormat,
          }))
        );
        allPreviewFormatIdMap = mergePreviewFormatIdMap(allPreviewFormatIdMap, preparedFormats);
        batchPcdFormatIdMaps.push(pcdFormatIdMap);
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const pcdFormatIdMap = batchPcdFormatIdMaps[i]!;
        const batchProfiles = this.buildQualityProfilesPayloads(
          batch.profiles,
          batch.suffix,
          pcdFormatIdMap,
          allPreviewFormatIdMap,
          qualityMappings
        );
        desiredProfiles.push(...batchProfiles);
        preparedBatches.push({
          sourceKind: batch.sourceKind,
          sourceLabel: batch.sourceLabel,
          databaseId: batch.databaseId,
          suffix: batch.suffix,
          trashNamespace: batch.trashNamespace,
          customFormats: preparedCustomFormatsByBatch[i]!,
          qualityProfiles: batchProfiles.map((payload, profileIndex) => ({
            pcdName: batch.profiles[profileIndex]!.pcdProfile.name,
            payload,
            remoteId: existingProfilesMap.get(payload.name) ?? null,
          })),
        });
      }

      this.recordPreviewEvidence('qualityProfiles', 'pcd', 'desiredPayloads', {
        arrType: this.instanceType,
        customFormats: desiredCustomFormats,
        qualityProfiles: desiredProfiles,
      });

      const customFormatChanges = diffEntityCollection<PreviewComparableCustomFormat, PreviewComparableCustomFormat>({
        entityType: 'customFormat',
        desiredEntities: desiredCustomFormats as unknown as readonly PreviewComparableCustomFormat[],
        currentEntities: allArrCustomFormats as unknown as readonly PreviewComparableCustomFormat[],
        desiredName: (entity) => entity.name,
        currentName: (entity) => entity.name,
        currentRemoteId: (entity) => entity.id ?? null,
        arrayKeyStrategies: CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES,
      });

      const qualityProfileChanges = diffEntityCollection<
        PreviewComparableQualityProfile,
        PreviewComparableQualityProfile
      >({
        entityType: 'qualityProfile',
        desiredEntities: desiredProfiles as unknown as readonly PreviewComparableQualityProfile[],
        currentEntities: allArrProfiles as unknown as readonly PreviewComparableQualityProfile[],
        desiredName: (entity) => entity.name,
        currentName: (entity) => entity.name,
        desiredComparable: (entity) => normalizeQualityProfileForPreview(entity as QualityProfileComparableInput),
        currentComparable: (entity) => normalizeQualityProfileForPreview(entity as QualityProfileComparableInput),
        currentRemoteId: (entity) => existingProfilesMap.get(entity.name) ?? null,
        arrayKeyStrategies: QUALITY_PROFILE_ARRAY_KEY_STRATEGIES,
      });

      const prunePlan = pruneLedger
        ? await planPreviewPrunes({
            client: this.client,
            instanceId: this.instanceId,
            instanceType: this.instanceType,
            reviewed: this.hasPreviewReviewRecorder(),
            ledger: pruneLedger,
            desiredCustomFormats,
            desiredProfiles,
            liveCustomFormats: allArrCustomFormats,
            liveQualityProfiles: allArrProfiles,
          })
        : null;

      const markedCustomFormatChanges = prunePlan
        ? markManagedDeletes(customFormatChanges, 'customFormat', prunePlan.prunes)
        : customFormatChanges;
      const markedQualityProfileChanges = prunePlan
        ? markManagedDeletes(qualityProfileChanges, 'qualityProfile', prunePlan.prunes)
        : qualityProfileChanges;

      const result: QualityProfilesPreview = {
        section: 'qualityProfiles',
        customFormats: markedCustomFormatChanges,
        qualityProfiles: markedQualityProfileChanges,
        ...blockedPrunesField(prunePlan?.blocked ?? []),
      };

      this.preparePreviewExecution({
        section: 'qualityProfiles',
        config: effectiveConfig,
        desired: { batches: preparedBatches },
        materialPlan: {
          arrType: this.instanceType,
          batchOrder: preparedBatches.map(
            (batch) => `${batch.sourceKind}:${batch.databaseId}:${batch.sourceLabel}:${batch.suffix}`
          ),
          prunes: prunePlan?.prunes ?? [],
        },
        currentGuards: {
          customFormats: allArrCustomFormats,
          qualityProfiles: allArrProfiles as unknown as PreviewComparableQualityProfile[],
        },
      });

      await logger.info(`Generated quality profile preview for "${this.instanceName}"`, {
        source: 'Preview:QualityProfiles',
        meta: {
          instanceId: this.instanceId,
          profileCount: desiredProfiles.length,
          customFormatCount: desiredCustomFormats.length,
          changes: {
            customFormats: customFormatChanges.length,
            qualityProfiles: qualityProfileChanges.length,
          },
        },
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await logger.error(`Failed to generate quality profile preview for "${this.instanceName}"`, {
        source: 'Preview:QualityProfiles',
        meta: { instanceId: this.instanceId, error: errorMsg },
      });

      throw error;
    }
  }

  /**
   * No profile is selected but the policy is on and the ledger is non-empty: everything Praxrr
   * created and no longer desires may still be pruned. Live Arr evidence is recorded under the same
   * keys as the normal path so a reviewed apply binds to it.
   */
  private async generateEmptySelectionPrunePreview(
    effectiveConfig: QualityProfilesPreviewConfig,
    ledger: readonly ArrManagedEntity[]
  ): Promise<QualityProfilesPreview> {
    const allArrCustomFormats = await this.client.getCustomFormats();
    this.recordPreviewEvidence('qualityProfiles', 'arr', 'customFormats', allArrCustomFormats);
    const allArrProfiles = await this.client.getQualityProfiles();
    this.recordPreviewEvidence('qualityProfiles', 'arr', 'qualityProfiles', allArrProfiles);

    const prunePlan = await planPreviewPrunes({
      client: this.client,
      instanceId: this.instanceId,
      instanceType: this.instanceType,
      reviewed: this.hasPreviewReviewRecorder(),
      ledger,
      desiredCustomFormats: [],
      desiredProfiles: [],
      liveCustomFormats: allArrCustomFormats,
      liveQualityProfiles: allArrProfiles,
    });

    const customFormats = markManagedDeletes(
      diffEntityCollection<PreviewComparableCustomFormat, PreviewComparableCustomFormat>({
        entityType: 'customFormat',
        desiredEntities: [],
        currentEntities: allArrCustomFormats as unknown as readonly PreviewComparableCustomFormat[],
        desiredName: (entity) => entity.name,
        currentName: (entity) => entity.name,
        currentRemoteId: (entity) => entity.id ?? null,
        arrayKeyStrategies: CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES,
      }),
      'customFormat',
      prunePlan.prunes
    );
    const qualityProfiles = markManagedDeletes(
      diffEntityCollection<PreviewComparableQualityProfile, PreviewComparableQualityProfile>({
        entityType: 'qualityProfile',
        desiredEntities: [],
        currentEntities: allArrProfiles as unknown as readonly PreviewComparableQualityProfile[],
        desiredName: (entity) => entity.name,
        currentName: (entity) => entity.name,
        currentRemoteId: (entity) => entity.id ?? null,
        arrayKeyStrategies: QUALITY_PROFILE_ARRAY_KEY_STRATEGIES,
      }),
      'qualityProfile',
      prunePlan.prunes
    );

    this.preparePreviewExecution({
      section: 'qualityProfiles',
      config: effectiveConfig,
      desired: { batches: [] },
      materialPlan: { arrType: this.instanceType, batchOrder: [], prunes: prunePlan.prunes },
      currentGuards: {
        customFormats: allArrCustomFormats,
        qualityProfiles: allArrProfiles as unknown as PreviewComparableQualityProfile[],
      },
    });

    return {
      section: 'qualityProfiles',
      customFormats,
      qualityProfiles,
      ...blockedPrunesField(prunePlan.blocked),
    };
  }

  /** Execute a reviewed plan without resolving config, PCD entities, mappings, or live Arr state again. */
  private async syncPreparedQualityProfiles(
    context: Readonly<QualityProfilesPreparedExecutionContext>
  ): Promise<SyncResult> {
    const outcomes: SyncEntityOutcome[] = [];
    const failedProfiles = new Set<string>();
    let syncedProfiles = 0;

    try {
      await logger.info(`Starting reviewed quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: {
          instanceId: this.instanceId,
          instanceType: this.instanceType,
        },
      });

      const expectedBatchOrder = context.desired.batches.map(
        (batch) => `${batch.sourceKind}:${batch.databaseId}:${batch.sourceLabel}:${batch.suffix}`
      );
      if (
        expectedBatchOrder.length !== context.materialPlan.batchOrder.length ||
        expectedBatchOrder.some((identity, index) => identity !== context.materialPlan.batchOrder[index])
      ) {
        throw new Error('Reviewed quality profile batch order does not match its material plan');
      }

      // Validate plan-unique synthetic ids before any DB or Arr write so a malformed plan fails
      // with nothing persisted.
      const plannedSyntheticIds = new Set<number>();
      for (const batch of context.desired.batches) {
        for (const { payload } of batch.customFormats) {
          if (typeof payload.id !== 'number' || payload.id >= 0) continue;
          if (plannedSyntheticIds.has(payload.id)) {
            throw new Error(`Reviewed quality profile plan reuses synthetic custom format id ${payload.id}`);
          }
          plannedSyntheticIds.add(payload.id);
        }
      }

      // Persist reviewed TRaSH namespaces (in batch order) before any Arr write; a namespace that
      // changed since review fails the whole run instead of writing under the wrong suffix.
      for (const batch of context.desired.batches) {
        if (batch.sourceKind !== 'trash') continue;
        if (!batch.trashNamespace || batch.suffix !== getTrashGuideNamespaceSuffix(batch.trashNamespace.index)) {
          throw new Error(`Reviewed TRaSH batch "${batch.sourceLabel}" has no verifiable namespace`);
        }
        confirmTrashNamespace(this.instanceId, batch.trashNamespace);
      }

      const guardedCustomFormatIds = new Map(
        context.currentGuards.customFormats
          .filter((format) => typeof format.id === 'number')
          .map((format) => [format.name, format.id!])
      );
      const guardedProfileIds = new Map(
        context.currentGuards.qualityProfiles
          .filter((profile) => typeof profile.id === 'number')
          .map((profile) => [profile.name, profile.id!])
      );

      // Reviewed formatItems carry planned ids: real Arr ids (kept as is) or plan-unique synthetic
      // ids for CFs created here. Their names mix bare PCD names (explicit scores) and Arr names
      // (zero-score filler), so a name can resolve to a different CF; resolve by planned id only
      // (#343).
      const createdFormatIds = new Map<number, number>();
      for (const batch of context.desired.batches) {
        for (const prepared of batch.customFormats) {
          const payload = structuredClone(prepared.payload);
          const plannedId = payload.id;
          const isUpdate = typeof plannedId === 'number' && plannedId >= 0;
          const guardedId = guardedCustomFormatIds.get(payload.name);
          if ((isUpdate && guardedId !== plannedId) || (!isUpdate && guardedId !== undefined)) {
            throw new Error(`Reviewed current-value guard mismatch for custom format "${payload.name}"`);
          }

          if (!isUpdate) delete payload.id;
          const write = await writeCustomFormatPayload(this.client, this.instanceId, this.instanceType, {
            pcdName: prepared.pcdName,
            payload,
          });
          outcomes.push(write.outcome);
          recordConfirmedWrite(this.instanceId, write.outcome, {
            sourceKind: batch.sourceKind,
            databaseId: batch.databaseId,
            arrName: payload.name,
          });
          if (typeof plannedId === 'number' && plannedId < 0 && write.remoteId !== null) {
            createdFormatIds.set(plannedId, write.remoteId);
          }
        }
      }

      for (const batch of context.desired.batches) {
        for (const prepared of batch.qualityProfiles) {
          const payload = structuredClone(prepared.payload);
          const guardedId = guardedProfileIds.get(payload.name);
          if (
            (prepared.remoteId !== null && guardedId !== prepared.remoteId) ||
            (prepared.remoteId === null && guardedId !== undefined)
          ) {
            throw new Error(`Reviewed current-value guard mismatch for quality profile "${payload.name}"`);
          }

          // A CF that was never created is absent from the Arr, so its zero-score fill entry is
          // dropped; a profile that actually scores it fails instead of sending a synthetic id.
          const unresolved = payload.formatItems.find(
            (item) => item.format < 0 && !createdFormatIds.has(item.format) && item.score !== 0
          );
          if (unresolved) {
            const reason = `Custom format "${unresolved.name}" was not created; cannot score it`;
            await logger.error(`Failed to sync quality profile "${prepared.pcdName}"`, {
              source: 'Sync:QualityProfiles',
              meta: { instanceId: this.instanceId, pcdName: prepared.pcdName, reason },
            });
            outcomes.push({
              section: 'qualityProfiles',
              arrType: this.instanceType,
              entityType: 'qualityProfile',
              name: prepared.pcdName,
              action: prepared.remoteId === null ? 'create' : 'update',
              status: 'failed',
              remoteId: prepared.remoteId === null ? null : String(prepared.remoteId),
              reason,
            });
            failedProfiles.add(prepared.pcdName);
            continue;
          }

          payload.formatItems = payload.formatItems.flatMap((item) => {
            if (item.format >= 0) return [item];
            const remoteId = createdFormatIds.get(item.format);
            return remoteId === undefined ? [] : [{ ...item, format: remoteId }];
          });
          const write = await this.writeQualityProfilePayload({
            pcdName: prepared.pcdName,
            payload,
            remoteId: prepared.remoteId,
          });
          outcomes.push(write.outcome);
          recordConfirmedWrite(this.instanceId, write.outcome, {
            sourceKind: batch.sourceKind,
            databaseId: batch.databaseId,
            arrName: payload.name,
          });
          if (write.summary) syncedProfiles += 1;
          else failedProfiles.add(prepared.pcdName);
        }
      }

      const pruneResult = await this.pruneReviewedEntities(context, outcomes, failedProfiles);
      const errors: string[] = [];
      if (failedProfiles.size > 0) errors.push(`Failed to sync ${failedProfiles.size} quality profile(s)`);
      if (pruneResult.failedDeletes > 0) {
        errors.push(`Failed to delete ${pruneResult.failedDeletes} managed entity(ies)`);
      }
      if (pruneResult.skippedDeletes > 0) {
        errors.push(pruneResult.skipReason ?? `Skipped ${pruneResult.skippedDeletes} reviewed deletion(s)`);
      }

      return errors.length > 0
        ? {
            success: false,
            itemsSynced: syncedProfiles,
            ...(failedProfiles.size > 0 ? { failedProfiles: [...failedProfiles] } : {}),
            error: errors.join('; '),
            outcomes,
          }
        : { success: true, itemsSynced: syncedProfiles, outcomes };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await logger.error(`Failed reviewed quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: { instanceId: this.instanceId, error: errorMsg },
      });
      return {
        success: false,
        itemsSynced: syncedProfiles,
        error: errorMsg,
        outcomes,
      };
    }
  }

  /** Reviewed deletes fail closed after any write failure and produce explicit outcomes. */
  private async pruneReviewedEntities(
    context: Readonly<QualityProfilesPreparedExecutionContext>,
    outcomes: SyncEntityOutcome[],
    failedProfiles: ReadonlySet<string>
  ): Promise<{ failedDeletes: number; skippedDeletes: number; skipReason?: string }> {
    const prunes = context.materialPlan.prunes;
    if (prunes.length === 0) return { failedDeletes: 0, skippedDeletes: 0 };

    if (failedProfiles.size > 0 || outcomes.some((outcome) => outcome.status === 'failed')) {
      await logger.warn(`Skipping reviewed prunes for "${this.instanceName}": a write failed in this run`, {
        source: 'Sync:QualityProfiles',
        meta: { instanceId: this.instanceId, plannedPrunes: prunes.length },
      });
      const reason = `Skipped ${prunes.length} reviewed deletion(s) because a write failed`;
      for (const item of prunes) {
        outcomes.push({
          section: 'qualityProfiles',
          arrType: this.instanceType,
          entityType: item.entityType,
          name: item.pcdName,
          action: 'delete',
          status: 'skipped',
          remoteId: String(item.remoteId),
          reason,
        });
      }
      return { failedDeletes: 0, skippedDeletes: prunes.length, skipReason: reason };
    }

    if (!isSyncHistoryEnabled()) {
      await logger.warn('Reviewed deletions will have no sync history record because sync history is disabled', {
        source: 'Sync:QualityProfiles',
        meta: { instanceId: this.instanceId, plannedPrunes: prunes.length },
      });
    }
    const pruneOutcomes = await executePrunes(this.client, this.instanceId, this.instanceType, prunes, {
      customFormats: context.currentGuards.customFormats,
      qualityProfiles: context.currentGuards.qualityProfiles.map(({ id, name, formatItems }) => ({
        id,
        name,
        formatItems: Array.isArray(formatItems)
          ? formatItems.map((value: unknown) => {
              if (typeof value !== 'object' || value === null) throw new Error('Invalid reviewed format reference');
              const item = value as Record<string, unknown>;
              return {
                ...(typeof item.format === 'number' ? { format: item.format } : {}),
                ...(typeof item.name === 'string' ? { name: item.name } : {}),
                ...(typeof item.score === 'number' ? { score: item.score } : {}),
              };
            })
          : undefined,
      })),
    });
    outcomes.push(...pruneOutcomes);
    return {
      failedDeletes: pruneOutcomes.filter((outcome) => outcome.status === 'failed').length,
      skippedDeletes: pruneOutcomes.filter((outcome) => outcome.status === 'skipped').length,
    };
  }

  /**
   * Fetch profiles and CFs grouped by database, each with a namespace suffix.
   */
  private async fetchSyncBatches(
    skippedOutcomes: SyncEntityOutcome[] | undefined,
    resolvedConfig: QualityProfilesPreviewConfig | undefined,
    trashNamespaceMode: 'allocate' | 'predict'
  ): Promise<DatabaseSyncBatch[]> {
    const syncConfig = resolvedConfig ?? this.getQualityProfilesSyncConfig();
    const batches: DatabaseSyncBatch[] = [];
    const byDatabase = new Map<number, typeof syncConfig.selections>();

    for (const selection of syncConfig.selections) {
      const existing = byDatabase.get(selection.databaseId) || [];
      existing.push(selection);
      byDatabase.set(selection.databaseId, existing);
    }

    // Emit one skipped outcome per selected profile that never reaches a write (issue #232, D5).
    const recordSkips = (selections: readonly ProfileSelection[], reason: string): void => {
      if (!skippedOutcomes) {
        return;
      }
      for (const selection of selections) {
        skippedOutcomes.push({
          section: 'qualityProfiles',
          arrType: this.instanceType,
          entityType: 'qualityProfile',
          name: selection.profileName,
          action: 'create',
          status: 'skipped',
          remoteId: null,
          reason,
        });
      }
    };

    for (const [databaseId, selections] of byDatabase) {
      // Skip stale references to deleted databases
      const dbInstance = databaseInstancesQueries.getById(databaseId);
      if (!dbInstance) {
        await logger.warn(`Skipping sync for deleted database ${databaseId}`, {
          source: 'Sync:QualityProfiles',
          meta: {
            instanceId: this.instanceId,
            databaseId,
            profileCount: selections.length,
          },
        });
        recordSkips(selections, `Source database ${databaseId} no longer exists.`);
        continue;
      }

      // Get or create namespace index for this (arr, database) pair
      const namespaceIndex = arrNamespaceQueries.getOrCreate(this.instanceId, databaseId);
      const suffix = getNamespaceSuffix(namespaceIndex);

      await logger.debug(`Database "${dbInstance?.name ?? databaseId}" assigned namespace index ${namespaceIndex}`, {
        source: 'Sync:Namespace',
        meta: {
          instanceId: this.instanceId,
          databaseId,
          databaseName: dbInstance?.name ?? null,
          namespaceIndex,
          suffixCodepoints: [...suffix].map(
            (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
          ),
          profileCount: selections.length,
        },
      });

      const cache = getCache(databaseId);
      if (!cache) {
        const cachedIds = getCachedDatabaseIds();

        await logger.warn(`PCD cache not found for database ${databaseId}`, {
          source: 'Sync:QualityProfiles',
          meta: {
            instanceId: this.instanceId,
            requestedDatabaseId: databaseId,
            cachedDatabaseIds: cachedIds,
            databaseExists: !!dbInstance,
            databaseEnabled: dbInstance?.enabled ?? null,
            databaseName: dbInstance?.name ?? null,
          },
        });
        recordSkips(selections, `PCD cache not available for database ${databaseId}.`);
        continue;
      }

      const profiles: ProfileSyncData[] = [];
      const customFormats = new Map<string, PcdCustomFormat>();

      for (const selection of selections) {
        // Fetch the quality profile
        const pcdProfile = await fetchQualityProfileFromPcd(cache, selection.profileName, this.instanceType);
        if (!pcdProfile) {
          await logger.warn(`Quality profile "${selection.profileName}" not found in database ${databaseId}`, {
            source: 'Sync:QualityProfiles',
            meta: {
              instanceId: this.instanceId,
              profileName: selection.profileName,
            },
          });
          recordSkips([selection], `Quality profile "${selection.profileName}" not found in its source database.`);
          continue;
        }

        // Get referenced custom format names
        const referencedFormatNames = await getReferencedCustomFormatNames(
          cache,
          selection.profileName,
          this.instanceType
        );

        profiles.push({ pcdProfile, referencedFormatNames });

        // Fetch custom formats (dedupe by name within this database)
        for (const formatName of referencedFormatNames) {
          if (!customFormats.has(formatName)) {
            const pcdFormat = await fetchCustomFormatFromPcd(cache, formatName);
            if (pcdFormat) {
              customFormats.set(formatName, pcdFormat);
            }
          }
        }
      }

      if (profiles.length > 0) {
        batches.push({
          sourceKind: 'pcd',
          sourceLabel: dbInstance?.name ?? `database:${databaseId}`,
          databaseId,
          suffix,
          profiles,
          customFormats,
          pcdFormatIdMap: new Map(),
        });
      }
    }

    const trashBatches = await this.fetchTrashSyncBatches(
      trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance(this.instanceId),
      trashNamespaceMode,
      skippedOutcomes
    );
    batches.push(...trashBatches);

    return batches;
  }

  private async fetchTrashSyncBatches(
    sourceHydrations: TrashGuideSyncQualityProfileSourceHydration[],
    trashNamespaceMode: 'allocate' | 'predict',
    skippedOutcomes?: SyncEntityOutcome[]
  ): Promise<DatabaseSyncBatch[]> {
    const sourceInputs: unknown[] = [];
    // Every hydrated source with selections, in hydration order (feeds the namespace plan).
    const resolutions: TrashSourceResolution[] = [];
    const pending: Omit<DatabaseSyncBatch, 'suffix' | 'trashNamespace'>[] = [];
    this.recordPreviewEvidence('qualityProfiles', 'pcd', 'trashSelections', sourceHydrations);

    // Emit one skipped outcome per user-selected TRaSH profile that never reaches a write
    // (issue #232, D5) — mirrors the PCD path's recordSkips so a selected profile is never
    // silently absent from the confirmed outcomes.
    const recordTrashSkips = (names: readonly string[], reason: string): void => {
      if (!skippedOutcomes) {
        return;
      }
      for (const profileName of names) {
        skippedOutcomes.push({
          section: 'qualityProfiles',
          arrType: this.instanceType,
          entityType: 'qualityProfile',
          name: profileName,
          action: 'create',
          status: 'skipped',
          remoteId: null,
          reason,
        });
      }
    };

    for (const sourceHydration of sourceHydrations) {
      if (sourceHydration.selectedQualityProfiles.length === 0) {
        continue;
      }

      const resolution = await resolveTrashSourceProfiles(sourceHydration, this.instanceType, {
        logSource: 'Sync:QualityProfiles',
        instanceId: this.instanceId,
        rowParseFailedMessage: 'Failed to parse TRaSH cache row while building quality profile sync batches',
        allRowsMalformedMessage: (sourceName) =>
          `Failed to parse all TRaSH cache rows for source "${sourceName}" during quality profile batch build`,
        someRowsMalformedMessage: 'Some TRaSH cache rows were malformed while building quality profile sync batches',
      });
      resolutions.push(resolution);
      if (resolution.status === 'unavailable') {
        sourceInputs.push({
          sourceHydration,
          source: resolution.source,
          cachedRows: [],
        });
        recordTrashSkips(
          sourceHydration.selectedQualityProfiles,
          `TRaSH source ${sourceHydration.sourceId} is unavailable or does not match this arr type.`
        );
        continue;
      }

      const { source, cachedRows } = resolution;
      sourceInputs.push({
        sourceHydration,
        source: {
          id: source.id,
          name: source.name,
          arrType: source.arr_type,
          scoreProfile: source.score_profile,
          enabled: source.enabled,
          lastCommitHash: source.last_commit_hash,
        },
        cachedRows: cachedRows.map((row) => ({
          trashId: row.trashId,
          entityType: row.entityType,
          name: row.name,
          jsonData: row.jsonData,
          filePath: row.filePath,
          contentHash: row.contentHash,
        })),
      });
      if (resolution.status === 'no_cache') {
        recordTrashSkips(sourceHydration.selectedQualityProfiles, `TRaSH source "${source.name}" has no cached data.`);
        continue;
      }
      if (resolution.status === 'transform_failed') {
        recordTrashSkips(
          sourceHydration.selectedQualityProfiles,
          `TRaSH source "${source.name}" could not be processed.`
        );
        continue;
      }

      for (const profileName of resolution.missingProfileNames) {
        recordTrashSkips([profileName], `TRaSH quality profile "${profileName}" was not found in its source.`);
      }

      const rawProfilesByName = new Map(
        resolution.parsed.entities.quality_profiles.map((profile) => [profile.name, profile])
      );
      const selectedProfiles: ProfileSyncData[] = [];
      const selectedFormatNames = new Set<string>();
      for (const profileName of resolution.resolvedProfileNames) {
        const portable = resolution.portableProfilesByName.get(profileName);
        if (!portable) {
          continue;
        }

        const rawProfile = rawProfilesByName.get(profileName);
        const pcdProfile = this.mapTrashPortableQualityProfileToPcd(portable, rawProfile?.upgrade_allowed ?? true);
        const referencedFormatNames = pcdProfile.customFormats.map((format) => format.formatName);
        for (const formatName of referencedFormatNames) {
          selectedFormatNames.add(formatName);
        }

        selectedProfiles.push({
          pcdProfile,
          referencedFormatNames,
        });
      }

      if (selectedProfiles.length === 0) {
        continue;
      }

      const customFormats = new Map<string, PcdCustomFormat>();
      for (const formatName of selectedFormatNames) {
        const portableFormat = resolution.portableFormatsByName.get(formatName);
        if (!portableFormat) {
          continue;
        }

        customFormats.set(formatName, this.mapTrashPortableCustomFormatToPcd(portableFormat));
      }

      pending.push({
        sourceKind: 'trash',
        sourceLabel: source.name,
        // Keep TRaSH namespaces disjoint from DB namespaces while still using strip-compatible chars.
        databaseId: -source.id,
        profiles: selectedProfiles,
        customFormats,
        pcdFormatIdMap: new Map(),
      });
    }

    // Persisted per-(instance, source) namespace (YAN-443): `allocate` for real syncs, read-only
    // `predict` for previews. Cleanup reads the same rows.
    const { plan, blockedSourceIds } = await planTrashNamespaces(this.instanceId, resolutions, trashNamespaceMode, () =>
      this.hasPriorTrashSync()
    );
    if (blockedSourceIds.length > 0) {
      const blockedNames = resolutions
        .filter((resolution) => resolution.source && blockedSourceIds.includes(resolution.source.id))
        .map((resolution) => `"${resolution.source!.name}"`)
        .join(', ');
      const reason =
        `TRaSH sync blocked: source(s) ${blockedNames} could not be resolved. Re-pull or disable them ` +
        'so TRaSH namespaces can be assigned safely.';
      for (const batch of pending) {
        recordTrashSkips(
          batch.profiles.map((profile) => profile.pcdProfile.name),
          reason
        );
      }
      this.recordPreviewEvidence('qualityProfiles', 'pcd', 'trashSourceMaterial', sourceInputs);
      return [];
    }

    const batches: DatabaseSyncBatch[] = [];
    for (const batch of pending) {
      const trashNamespace = plan.get(-batch.databaseId);
      if (!trashNamespace) {
        throw new Error(`TRaSH source "${batch.sourceLabel}" has no planned namespace`);
      }
      batches.push({ ...batch, suffix: getTrashGuideNamespaceSuffix(trashNamespace.index), trashNamespace });
    }

    this.recordPreviewEvidence('qualityProfiles', 'pcd', 'trashSourceMaterial', sourceInputs);

    return batches;
  }

  /**
   * Whether this Arr already holds TRaSH-suffixed items, i.e. TRaSH profiles were synced here
   * under the pre-YAN-443 positional scheme. The live Arr is the ground truth: the app DB has no
   * reliable record (TRaSH per-source `last_synced_at` is never written by the sync path, the QP
   * section `last_synced_at` is reset whenever selections are saved, and sync history is pruned by
   * retention and does not record TRaSH sources). Only consulted when the instance has no
   * persisted TRaSH namespaces and some source is unresolved. An unreadable Arr counts as "yes",
   * which blocks TRaSH writes for the pass rather than risking a namespace collision.
   */
  private async hasPriorTrashSync(): Promise<boolean> {
    try {
      const [profiles, formats] = await Promise.all([this.client.getQualityProfiles(), this.client.getCustomFormats()]);
      return [...profiles, ...formats].some((entity) =>
        isTrashGuideNamespaceSuffix(getTrailingNamespaceSuffix(entity.name))
      );
    } catch {
      return true;
    }
  }

  private getQualityProfilesSyncConfig(): QualityProfilesPreviewConfig {
    if (this.hasPreviewConfig()) {
      const previewConfig = parseQualityProfilesPreviewConfig(this.getPreviewConfig());
      if (!previewConfig) {
        throw new Error('Invalid reviewed quality profile configuration');
      }
      return previewConfig;
    }

    return {
      selections: arrSyncQueries.getQualityProfilesSync(this.instanceId).selections,
    };
  }

  /**
   * Get quality API mappings from the first available database cache.
   * All databases should have the same quality mappings from the schema PCD.
   */
  private async getQualityMappings(batches: DatabaseSyncBatch[]): Promise<Map<string, string>> {
    let hasPcdBatch = false;
    for (const batch of batches) {
      if (batch.sourceKind !== 'pcd' || batch.databaseId <= 0) {
        continue;
      }
      hasPcdBatch = true;

      const cache = getCache(batch.databaseId);
      if (cache) {
        return getQualityApiMappings(cache, this.instanceType);
      }
    }

    if (hasPcdBatch) {
      throw new Error('No PCD cache available for quality API mappings');
    }

    return new Map();
  }

  private mapTrashPortableCustomFormatToPcd(format: PortableCustomFormat): PcdCustomFormat {
    return {
      id: 0,
      name: format.name,
      includeInRename: format.includeInRename,
      conditions: format.conditions.map((condition) => ({
        ...condition,
        arrType: condition.arrType && condition.arrType.length > 0 ? condition.arrType : 'all',
      })),
    };
  }

  private mapTrashPortableQualityProfileToPcd(
    profile: PortableQualityProfile,
    upgradesAllowed: boolean
  ): PcdQualityProfile {
    return {
      id: 0,
      name: profile.name,
      upgradesAllowed,
      minimumCustomFormatScore: profile.minimumScore,
      upgradeUntilScore: profile.upgradeUntilScore,
      upgradeScoreIncrement: profile.upgradeScoreIncrement,
      qualities: profile.orderedItems.map((item, index) => ({
        type: item.type,
        referenceId: index + 1,
        name: item.name,
        position: item.position,
        enabled: item.enabled,
        upgradeUntil: item.upgradeUntil,
        members: item.members?.map((member, memberIndex) => ({
          id: memberIndex + 1,
          name: member.name,
        })),
      })),
      language: profile.language
        ? {
            id: 1,
            name: profile.language,
            type: 'simple',
          }
        : null,
      customFormats: profile.customFormatScores
        .filter((score) => score.arrType === this.instanceType || score.arrType === 'all')
        .map((score, index) => ({
          formatId: index + 1,
          formatName: score.customFormatName,
          score: score.score,
        })),
    };
  }

  /**
   * Sync quality profiles for a single database batch.
   */
  private async syncQualityProfiles(
    profiles: ProfileSyncData[],
    suffix: string,
    pcdFormatIdMap: Map<string, number>,
    allFormatIdMap: Map<string, number>,
    qualityMappings: Map<string, string>,
    existingMap: Map<string, number>,
    failedProfiles: Set<string>,
    outcomes: SyncEntityOutcome[],
    provenance: { readonly sourceKind: 'pcd' | 'trash'; readonly databaseId: number }
  ): Promise<SyncedProfileSummary[]> {
    const syncedProfiles: SyncedProfileSummary[] = [];

    for (const { pcdProfile } of profiles) {
      const arrProfile = this.buildQualityProfilePayload(
        pcdProfile,
        suffix,
        pcdFormatIdMap,
        allFormatIdMap,
        qualityMappings
      );
      const suffixedName = arrProfile.name;

      await logger.debug(`Compiled quality profile "${pcdProfile.name}" (suffixed)`, {
        source: 'Compile:QualityProfile',
        meta: {
          instanceId: this.instanceId,
          pcdName: pcdProfile.name,
          profile: arrProfile,
        },
      });

      if (isPluginsEnabled()) {
        try {
          await pluginHost.notifyObservers('config.profileCompiled.observe', () =>
            buildCapabilityInput('read:resolved-profile', { ...pcdProfile, arrType: this.instanceType })
          );
        } catch (error) {
          await logger.warn('config.profileCompiled.observe dispatch failed at call-site', {
            source: 'Plugins',
            meta: { instanceId: this.instanceId, pcdName: pcdProfile.name, error: String(error) },
          });
        }
      }

      const write = await this.writeQualityProfilePayload({
        pcdName: pcdProfile.name,
        payload: arrProfile,
        remoteId: existingMap.get(suffixedName) ?? null,
      });
      outcomes.push(write.outcome);
      recordConfirmedWrite(this.instanceId, write.outcome, { ...provenance, arrName: suffixedName });
      if (write.summary && write.remoteId !== null) {
        syncedProfiles.push(write.summary);
        existingMap.set(suffixedName, write.remoteId);
      } else {
        failedProfiles.add(pcdProfile.name);
      }
    }

    return syncedProfiles;
  }

  /** Write one already-materialized quality-profile payload without re-reading evidence. */
  private async writeQualityProfilePayload(
    prepared: PreparedQualityProfileWrite
  ): Promise<QualityProfilePayloadWriteResult> {
    const payload = structuredClone(prepared.payload);
    const isUpdate = prepared.remoteId !== null;

    try {
      let remoteId: number;
      if (prepared.remoteId !== null) {
        payload.id = prepared.remoteId;
        remoteId = prepared.remoteId;
        await this.client.updateQualityProfile(remoteId, payload);
        await logger.debug(`Updated quality profile "${prepared.pcdName}"`, {
          source: 'Sync:QualityProfiles',
          meta: {
            instanceId: this.instanceId,
            profileId: remoteId,
            pcdName: prepared.pcdName,
            suffixedName: payload.name,
          },
        });
      } else {
        delete payload.id;
        const response = await this.client.createQualityProfile(payload);
        if (typeof response.id !== 'number' || !Number.isInteger(response.id) || response.id <= 0) {
          throw new Error(`Arr did not return an id for quality profile "${prepared.pcdName}"`);
        }
        remoteId = response.id;
        await logger.debug(`Created quality profile "${prepared.pcdName}"`, {
          source: 'Sync:QualityProfiles',
          meta: {
            instanceId: this.instanceId,
            profileId: remoteId,
            pcdName: prepared.pcdName,
            suffixedName: payload.name,
          },
        });
      }

      const formats = payload.formatItems
        .filter((format) => format.score !== 0)
        .map((format) => ({ name: format.name, score: format.score }));
      return {
        remoteId,
        summary: {
          name: prepared.pcdName,
          action: isUpdate ? 'updated' : 'created',
          language: payload.language?.name ?? 'N/A',
          cutoffFormatScore: payload.cutoffFormatScore,
          minFormatScore: payload.minFormatScore,
          formats,
        },
        outcome: {
          section: 'qualityProfiles',
          arrType: this.instanceType,
          entityType: 'qualityProfile',
          name: prepared.pcdName,
          action: isUpdate ? 'update' : 'create',
          status: 'success',
          remoteId: String(remoteId),
          reason: null,
        },
      };
    } catch (error) {
      const { reason, protectedDetails } = sanitizeArrWriteError(error);
      await logger.error(`Failed to sync quality profile "${prepared.pcdName}"`, {
        source: 'Sync:QualityProfiles',
        meta: {
          instanceId: this.instanceId,
          pcdName: prepared.pcdName,
          suffixedName: payload.name,
          request: payload,
          ...protectedDetails,
        },
      });
      return {
        remoteId: null,
        summary: null,
        outcome: {
          section: 'qualityProfiles',
          arrType: this.instanceType,
          entityType: 'qualityProfile',
          name: prepared.pcdName,
          action: isUpdate ? 'update' : 'create',
          status: 'failed',
          remoteId: prepared.remoteId === null ? null : String(prepared.remoteId),
          reason,
        },
      };
    }
  }

  private buildQualityProfilesPayloads(
    profiles: ProfileSyncData[],
    suffix: string,
    pcdFormatIdMap: Map<string, number>,
    allFormatIdMap: Map<string, number>,
    qualityMappings: Map<string, string>
  ): ArrQualityProfilePayload[] {
    return profiles.map(({ pcdProfile }) =>
      transformQualityProfileWithSuffix(
        pcdProfile,
        this.instanceType,
        qualityMappings,
        pcdFormatIdMap,
        allFormatIdMap,
        suffix
      )
    );
  }

  private buildQualityProfilePayload(
    profile: PcdQualityProfile,
    suffix: string,
    pcdFormatIdMap: Map<string, number>,
    allFormatIdMap: Map<string, number>,
    qualityMappings: Map<string, string>
  ): ArrQualityProfilePayload {
    return transformQualityProfileWithSuffix(
      profile,
      this.instanceType,
      qualityMappings,
      pcdFormatIdMap,
      allFormatIdMap,
      suffix
    );
  }

  // Base class abstract methods - implemented but not used since we override sync()
  protected async fetchFromPcd(): Promise<unknown[]> {
    return [];
  }

  protected transformToArr(_pcdData: unknown[]): unknown[] {
    return [];
  }

  protected async pushToArr(_arrData: unknown[]): Promise<void> {
    // Not used - logic is in sync()
  }
}
