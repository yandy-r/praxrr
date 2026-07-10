/**
 * Media management syncer
 * Syncs media management settings from PCD to arr instances
 *
 * Handles three types of configs per arr_type (radarr, sonarr, lidarr):
 * 1. Media Settings (downloadPropersAndRepacks, enableMediaInfo)
 * 2. Naming (arr-specific naming formats, folder formats)
 * 3. Quality Definitions (quality size limits per mapping)
 *
 * Flow for each:
 * 1. GET existing config from arr
 * 2. Fetch settings from PCD
 * 3. Modify only the fields we care about
 * 4. PUT the full config back to arr
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import type { SyncEntityOutcome, SyncOutcomeEntityType } from '../types.ts';
import { sanitizeArrWriteError } from '../sanitizeArrWriteError.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { toPortableNaming } from '$lib/server/trashguide/transformers/mediaManagement.ts';
import { toPortableQualityDefinitions } from '$lib/server/trashguide/transformers/qualityProfiles.ts';
import type {
  TrashGuideNamingEntity,
  TrashGuideQualitySizeEntity,
  TrashGuideSupportedArrType,
} from '$lib/server/trashguide/types.ts';
import { getCache, type PCDCache } from '$pcd/index.ts';
import {
  getLidarrByName as getLidarrMediaSettings,
  getRadarrByName as getRadarrMediaSettings,
  getSonarrByName as getSonarrMediaSettings,
} from '$pcd/entities/mediaManagement/media-settings/read.ts';
import {
  getLidarrByName as getLidarrNaming,
  getRadarrByName as getRadarrNaming,
  getSonarrByName as getSonarrNaming,
} from '$pcd/entities/mediaManagement/naming/read.ts';
import {
  getLidarrByName as getLidarrQualityDefs,
  getQualityApiMappings,
  getRadarrByName as getRadarrQualityDefs,
  getSonarrByName as getSonarrQualityDefs,
  isKnownQualityApiName,
} from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import type {
  LidarrMediaSettingsRow,
  LidarrNamingRow,
  QualityDefinitionsConfig,
  RadarrMediaSettingsRow,
  RadarrNamingRow,
  SonarrMediaSettingsRow,
  SonarrNamingRow,
} from '$shared/pcd/display.ts';
import { colonReplacementToDb, multiEpisodeStyleToDb } from '$shared/pcd/mediaManagement.ts';
import type {
  ArrNamingConfig,
  ArrMediaManagementConfig,
  RadarrNamingConfig,
  ArrPropersAndRepacks,
  ArrType,
  ArrQualityDefinition,
  SonarrNamingConfig,
} from '$arr/types.ts';
import { logger } from '$logger/logger.ts';
import { diffSingletonEntity } from '../preview/sectionDiffs.ts';
import type { EntityChange, MediaManagementPreview, SyncPreviewPreparedExecutionContext } from '../preview/types.ts';
import {
  getUnsupportedMediaManagementSubsectionReason,
  getUnsupportedSyncSectionReason,
  isSyncSectionSupported,
  type MediaManagementSubsection,
  type SyncArrType,
} from '../mappings.ts';

const LIDARR_UNSUPPORTED_FIELD_REASON =
  'Field is not represented by the Lidarr API config payload and is skipped during sync';
const LIDARR_NAMING_SOURCE_FIELD_REASON =
  'Some stored Lidarr naming fields do not map to current Lidarr API payload fields and are skipped';
const LIDARR_QUALITY_SKIP_REASON =
  'Lidarr quality definition sync applies only to entries with Lidarr mappings and matching Lidarr definitions';

/**
 * Terminal result of a single media-management subsection write (issue #232). Replaces the
 * old bare `boolean` return, which conflated real errors, absent config, and unsupported-field
 * skips. `noop` = the subsection was never configured (no entity attempted → no outcome). The
 * other three each become exactly one {@link SyncEntityOutcome}.
 */
type MediaSubStatus = 'success' | 'skipped' | 'failed' | 'noop';
interface MediaSubsectionResult {
  status: MediaSubStatus;
  reason?: string;
  remoteId?: string | null;
}

const subOk = (remoteId: string | null = null): MediaSubsectionResult => ({ status: 'success', remoteId });
const subSkip = (reason: string): MediaSubsectionResult => ({ status: 'skipped', reason });
const subFail = (reason: string): MediaSubsectionResult => ({ status: 'failed', reason });
const subNoop = (): MediaSubsectionResult => ({ status: 'noop' });

/** Read a singleton config's remote id defensively (media-management/naming configs are singletons). */
function readConfigId(config: unknown): string | null {
  if (config && typeof config === 'object' && 'id' in config) {
    const id = (config as { id?: unknown }).id;
    if (typeof id === 'number') {
      return String(id);
    }
  }
  return null;
}

interface MediaManagementSyncConfig {
  namingDatabaseId: number | null;
  namingConfigName: string | null;
  qualityDefinitionsDatabaseId: number | null;
  qualityDefinitionsConfigName: string | null;
  mediaSettingsDatabaseId: number | null;
  mediaSettingsConfigName: string | null;
}

type MediaManagementSourceKind = 'pcd' | 'trash';

interface PreparedMediaManagementWrite {
  readonly name: string;
  readonly sourceKind: MediaManagementSourceKind;
  readonly payload: Record<string, unknown>;
  readonly remoteId: string | null;
}

interface PreparedQualityDefinitionsWrite {
  readonly name: string;
  readonly sourceKind: MediaManagementSourceKind;
  readonly payload: readonly ArrQualityDefinition[];
  readonly matchedRemoteIds: readonly number[];
}

interface MediaManagementPreparedExecutionContext extends SyncPreviewPreparedExecutionContext {
  readonly section: 'mediaManagement';
  readonly config: MediaManagementSyncConfig;
  readonly desired: {
    readonly mediaSettings: PreparedMediaManagementWrite | null;
    readonly naming: PreparedMediaManagementWrite | null;
    readonly qualityDefinitions: PreparedQualityDefinitionsWrite | null;
  };
  readonly materialPlan: {
    readonly arrType: SyncArrType;
    readonly subsectionOrder: readonly ['mediaSettings', 'naming', 'qualityDefinitions'];
    readonly selections: Readonly<Record<'mediaSettings' | 'naming' | 'qualityDefinitions', unknown>>;
    readonly capabilities: Readonly<Record<'mediaSettings' | 'naming' | 'qualityDefinitions', unknown>>;
  };
  readonly currentGuards: {
    readonly mediaSettings: Record<string, unknown> | null;
    readonly naming: Record<string, unknown> | null;
    readonly qualityDefinitions: readonly ArrQualityDefinition[];
  };
}

interface MediaManagementReviewAccumulator {
  pcd: {
    selection: MediaManagementSyncConfig;
    mediaSettingsSource: unknown;
    namingSource: unknown;
    qualityDefinitionsSource: unknown;
    qualityApiMappings: readonly (readonly [string, string])[];
  };
  arr: {
    target: { arrType: SyncArrType };
    mediaSettingsCurrent: Record<string, unknown> | null;
    namingCurrent: Record<string, unknown> | null;
    qualityDefinitionsCurrent: readonly ArrQualityDefinition[];
  };
  desired: {
    mediaSettings: PreparedMediaManagementWrite | null;
    naming: PreparedMediaManagementWrite | null;
    qualityDefinitions: PreparedQualityDefinitionsWrite | null;
  };
  selections: Record<'mediaSettings' | 'naming' | 'qualityDefinitions', unknown>;
  capabilities: Record<'mediaSettings' | 'naming' | 'qualityDefinitions', unknown>;
}

function createReviewAccumulator(
  syncConfig: MediaManagementSyncConfig,
  arrType: SyncArrType
): MediaManagementReviewAccumulator {
  return {
    pcd: {
      selection: structuredClone(syncConfig),
      mediaSettingsSource: null,
      namingSource: null,
      qualityDefinitionsSource: null,
      qualityApiMappings: [],
    },
    arr: {
      target: { arrType },
      mediaSettingsCurrent: null,
      namingCurrent: null,
      qualityDefinitionsCurrent: [],
    },
    desired: {
      mediaSettings: null,
      naming: null,
      qualityDefinitions: null,
    },
    selections: {
      mediaSettings: null,
      naming: null,
      qualityDefinitions: null,
    },
    capabilities: {
      mediaSettings: null,
      naming: null,
      qualityDefinitions: null,
    },
  };
}

function parsePositiveInt(rawValue: unknown): number | null {
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue <= 0) {
    return null;
  }

  return rawValue;
}

function parseMediaManagementSectionSelection(
  rawDatabaseId: unknown,
  rawConfigName: unknown
): { databaseId: number | null; configName: string | null } {
  return {
    databaseId: rawDatabaseId === null || rawDatabaseId === undefined ? null : parsePositiveInt(rawDatabaseId),
    configName: typeof rawConfigName === 'string' && rawConfigName.trim().length > 0 ? rawConfigName : null,
  };
}

function parseMediaManagementPreviewConfig(rawConfig: unknown): MediaManagementSyncConfig | null {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return null;
  }

  const value = rawConfig as Record<string, unknown>;
  if (
    !('namingDatabaseId' in value) ||
    !('namingConfigName' in value) ||
    !('qualityDefinitionsDatabaseId' in value) ||
    !('qualityDefinitionsConfigName' in value) ||
    !('mediaSettingsDatabaseId' in value) ||
    !('mediaSettingsConfigName' in value)
  ) {
    return null;
  }

  const naming = parseMediaManagementSectionSelection(value.namingDatabaseId, value.namingConfigName);
  const qualityDefinitions = parseMediaManagementSectionSelection(
    value.qualityDefinitionsDatabaseId,
    value.qualityDefinitionsConfigName
  );
  const mediaSettings = parseMediaManagementSectionSelection(
    value.mediaSettingsDatabaseId,
    value.mediaSettingsConfigName
  );

  return {
    namingDatabaseId: naming.databaseId,
    namingConfigName: naming.configName,
    qualityDefinitionsDatabaseId: qualityDefinitions.databaseId,
    qualityDefinitionsConfigName: qualityDefinitions.configName,
    mediaSettingsDatabaseId: mediaSettings.databaseId,
    mediaSettingsConfigName: mediaSettings.configName,
  };
}

type NamingRow = RadarrNamingRow | SonarrNamingRow | LidarrNamingRow;

interface NamingSource {
  getByName: (cache: PCDCache, configName: string) => Promise<NamingRow | null>;
  entityType: 'radarr_naming' | 'sonarr_naming' | 'lidarr_naming';
  toDesiredPayload: (naming: NamingRow) => Record<string, unknown>;
}

const LIDARR_UNSUPPORTED_NAMING_SOURCE_FIELDS = ['artist_name'] as const;

export class MediaManagementSyncer extends BaseSyncer {
  private instanceType: ArrType;

  constructor(
    client: ConstructorParameters<typeof BaseSyncer>[0],
    instanceId: number,
    instanceName: string,
    instanceType: ArrType
  ) {
    super(client, instanceId, instanceName);
    this.instanceType = instanceType;
  }

  private async generateMediaSettingsPreview(
    databaseId: number | null,
    configName: string | null,
    instanceType: SyncArrType,
    review: MediaManagementReviewAccumulator
  ): Promise<EntityChange | null> {
    this.assertMediaManagementSubsectionSupported('mediaSettings', instanceType);

    if (!databaseId || !configName) {
      await logger.warn('Media settings preview skipped because it is not configured', {
        source: 'Preview:MediaManagement',
        meta: {
          instanceId: this.instanceId,
          subsection: 'mediaSettings',
          code: 'missing_optional_config',
        },
      });
      return null;
    }

    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Preview:MediaSettings',
        meta: { instanceId: this.instanceId },
      });
      return null;
    }

    const mediaSettingsSource = this.resolveMediaSettingsSource();
    if (!mediaSettingsSource) {
      await logger.warn(`Unsupported instance type for media settings preview: ${this.instanceType}`, {
        source: 'Preview:MediaSettings',
        meta: { instanceId: this.instanceId, subsection: 'mediaSettings' },
      });
      return null;
    }

    const mediaSettings = await mediaSettingsSource.getByName(cache, configName);
    if (!mediaSettings) {
      await logger.debug(`Media settings config "${configName}" not found in ${mediaSettingsSource.entityType}`, {
        source: 'Preview:MediaSettings',
        meta: {
          instanceId: this.instanceId,
          configName,
          subsection: 'mediaSettings',
          entityType: mediaSettingsSource.entityType,
        },
      });
      return null;
    }

    review.pcd.mediaSettingsSource = {
      sourceKind: 'pcd',
      databaseId,
      entityType: mediaSettingsSource.entityType,
      configName,
      row: mediaSettings,
    };
    review.selections.mediaSettings = {
      sourceKind: 'pcd',
      databaseId,
      entityType: mediaSettingsSource.entityType,
      configName,
    };

    const existingConfig = (await this.client.getMediaManagementConfig()) as ArrMediaManagementConfig;
    const managedUpdates = {
      downloadPropersAndRepacks: this.mapPropersRepacks(mediaSettings.propers_repacks),
      enableMediaInfo: mediaSettings.enable_media_info,
    };

    let updatedConfig: ArrMediaManagementConfig = {
      ...existingConfig,
      ...managedUpdates,
    };
    let appliedFields = Object.keys(managedUpdates).sort();
    let missingFields: string[] = [];
    if (this.instanceType === 'lidarr') {
      const applied = this.applyConfigUpdates(existingConfig, managedUpdates);
      updatedConfig = applied.updatedConfig;
      appliedFields = applied.appliedFields;
      missingFields = applied.missingFields;
      review.arr.mediaSettingsCurrent = existingConfig as Record<string, unknown>;
      review.capabilities.mediaSettings = {
        observedFields: Object.keys(existingConfig).sort(),
        appliedFields,
        missingFields,
      };
      if (applied.appliedFields.length === 0) {
        await logger.warn('No supported Lidarr media settings fields available to preview', {
          source: 'Preview:MediaSettings',
          meta: {
            instanceId: this.instanceId,
            configName,
            subsection: 'mediaSettings',
            missingFields: applied.missingFields,
            reason: LIDARR_UNSUPPORTED_FIELD_REASON,
          },
        });
        return null;
      }

      if (applied.missingFields.length > 0) {
        await logger.warn('Skipping unsupported Lidarr media settings fields', {
          source: 'Preview:MediaSettings',
          meta: {
            instanceId: this.instanceId,
            configName,
            missingFields: applied.missingFields,
            reason: LIDARR_UNSUPPORTED_FIELD_REASON,
            subsection: 'mediaSettings',
          },
        });
      }
    }

    review.arr.mediaSettingsCurrent = existingConfig as Record<string, unknown>;
    review.capabilities.mediaSettings ??= {
      observedFields: Object.keys(existingConfig).sort(),
      appliedFields,
      missingFields,
    };
    review.desired.mediaSettings = {
      name: configName,
      sourceKind: 'pcd',
      payload: updatedConfig as Record<string, unknown>,
      remoteId: readConfigId(existingConfig),
    };

    return diffSingletonEntity({
      entityType: 'mediaSettings',
      name: configName,
      desiredEntity: updatedConfig,
      currentEntity: existingConfig,
      currentRemoteId: (entity) => entity.id,
    });
  }

  private async generateNamingPreview(
    databaseId: number | null,
    configName: string | null,
    instanceType: SyncArrType,
    review: MediaManagementReviewAccumulator
  ): Promise<EntityChange | null> {
    this.assertMediaManagementSubsectionSupported('naming', instanceType);

    if (!databaseId || !configName) {
      await logger.warn('Naming preview skipped because it is not configured', {
        source: 'Preview:MediaManagement',
        meta: {
          instanceId: this.instanceId,
          subsection: 'naming',
          code: 'missing_optional_config',
        },
      });
      return null;
    }

    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Preview:Naming',
        meta: { instanceId: this.instanceId },
      });
      return null;
    }

    const namingSource = this.resolveNamingSource();
    if (!namingSource) {
      await logger.warn(`Unsupported instance type for naming preview: ${this.instanceType}`, {
        source: 'Preview:Naming',
        meta: { instanceId: this.instanceId, subsection: 'naming' },
      });
      return null;
    }

    const namingConfig = await namingSource.getByName(cache, configName);
    if (!namingConfig) {
      await logger.debug(`Naming config "${configName}" not found in ${namingSource.entityType}`, {
        source: 'Preview:Naming',
        meta: { instanceId: this.instanceId, configName, subsection: 'naming', entityType: namingSource.entityType },
      });
      return null;
    }

    review.pcd.namingSource = {
      sourceKind: 'pcd',
      databaseId,
      entityType: namingSource.entityType,
      configName,
      row: namingConfig,
    };
    review.selections.naming = {
      sourceKind: 'pcd',
      databaseId,
      entityType: namingSource.entityType,
      configName,
    };

    const existingConfig = (await this.client.getNamingConfig()) as ArrNamingConfig;
    const previewConfig = namingSource.toDesiredPayload(namingConfig);
    const currentConfig = existingConfig as Record<string, unknown>;
    let finalConfig: Record<string, unknown> = {
      ...currentConfig,
      ...previewConfig,
    };
    let appliedFields = Object.keys(previewConfig).sort();
    let missingFields: string[] = [];

    if (this.instanceType === 'lidarr') {
      const applied = this.applyConfigUpdates(currentConfig, previewConfig);
      finalConfig = {
        ...currentConfig,
        ...applied.updatedConfig,
      };
      appliedFields = applied.appliedFields;
      missingFields = applied.missingFields;
      review.arr.namingCurrent = currentConfig;
      review.capabilities.naming = {
        observedFields: Object.keys(currentConfig).sort(),
        appliedFields,
        missingFields,
        unsupportedSourceFields: [...LIDARR_UNSUPPORTED_NAMING_SOURCE_FIELDS],
      };

      if (applied.missingFields.length > 0) {
        await logger.warn('Skipping unsupported Lidarr naming target fields', {
          source: 'Preview:Naming',
          meta: {
            instanceId: this.instanceId,
            configName,
            missingFields: applied.missingFields,
            reason: LIDARR_UNSUPPORTED_FIELD_REASON,
            subsection: 'naming',
          },
        });
      }

      if (applied.appliedFields.length === 0) {
        await logger.warn('No supported Lidarr naming fields available to preview', {
          source: 'Preview:Naming',
          meta: {
            instanceId: this.instanceId,
            configName,
            reason: LIDARR_UNSUPPORTED_FIELD_REASON,
            subsection: 'naming',
          },
        });
        return null;
      }

      await logger.debug('Skipping unsupported Lidarr naming source fields', {
        source: 'Preview:Naming',
        meta: {
          instanceId: this.instanceId,
          configName,
          subsection: 'naming',
          skippedFields: [...LIDARR_UNSUPPORTED_NAMING_SOURCE_FIELDS],
          reason: LIDARR_NAMING_SOURCE_FIELD_REASON,
        },
      });
    }

    review.arr.namingCurrent = currentConfig;
    review.capabilities.naming ??= {
      observedFields: Object.keys(currentConfig).sort(),
      appliedFields,
      missingFields,
      unsupportedSourceFields: this.instanceType === 'lidarr' ? [...LIDARR_UNSUPPORTED_NAMING_SOURCE_FIELDS] : [],
    };
    review.desired.naming = {
      name: configName,
      sourceKind: 'pcd',
      payload: finalConfig,
      remoteId: readConfigId(existingConfig),
    };

    return diffSingletonEntity({
      entityType: 'naming',
      name: configName,
      desiredEntity: finalConfig,
      currentEntity: currentConfig,
      currentRemoteId: (entity) => (entity as { id?: number | null }).id ?? null,
    });
  }

  private async generateQualityDefinitionsPreview(
    databaseId: number | null,
    configName: string | null,
    instanceType: SyncArrType,
    review: MediaManagementReviewAccumulator
  ): Promise<readonly EntityChange[]> {
    this.assertMediaManagementSubsectionSupported('qualityDefinitions', instanceType);

    if (!databaseId || !configName) {
      await logger.warn('Quality definitions preview skipped because it is not configured', {
        source: 'Preview:MediaManagement',
        meta: {
          instanceId: this.instanceId,
          subsection: 'qualityDefinitions',
          code: 'missing_optional_config',
        },
      });
      return [];
    }

    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Preview:QualityDefinitions',
        meta: { instanceId: this.instanceId },
      });
      return [];
    }

    const qualityDefinitionsSource = this.resolveQualityDefinitionsSource();
    if (!qualityDefinitionsSource) {
      await logger.warn(`Unsupported instance type for quality definitions preview: ${this.instanceType}`, {
        source: 'Preview:QualityDefinitions',
        meta: { instanceId: this.instanceId, subsection: 'qualityDefinitions' },
      });
      return [];
    }

    const qualityDefsConfig = await qualityDefinitionsSource.getByName(cache, configName);
    if (!qualityDefsConfig) {
      await logger.debug(
        `Quality definitions config "${configName}" not found in ${qualityDefinitionsSource.entityType}`,
        {
          source: 'Preview:QualityDefinitions',
          meta: { instanceId: this.instanceId, configName, subsection: 'qualityDefinitions' },
        }
      );
      return [];
    }

    review.pcd.qualityDefinitionsSource = {
      sourceKind: 'pcd',
      databaseId,
      entityType: qualityDefinitionsSource.entityType,
      configName,
      config: qualityDefsConfig,
    };
    review.selections.qualityDefinitions = {
      sourceKind: 'pcd',
      databaseId,
      entityType: qualityDefinitionsSource.entityType,
      configName,
    };

    if (qualityDefsConfig.entries.length === 0) {
      await logger.debug(`Quality definitions config "${configName}" has no entries`, {
        source: 'Preview:QualityDefinitions',
        meta: { instanceId: this.instanceId, configName, subsection: 'qualityDefinitions' },
      });
      return [];
    }

    const apiMappings = await this.getQualityApiMappings(cache);
    review.pcd.qualityApiMappings = [...apiMappings.entries()].sort(([left], [right]) => left.localeCompare(right));
    if (instanceType === 'lidarr' && apiMappings.size === 0) {
      await logger.warn('Skipping Lidarr quality definitions preview due missing mappings', {
        source: 'Preview:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          subsection: 'qualityDefinitions',
          reason: LIDARR_QUALITY_SKIP_REASON,
        },
      });
      return [];
    }

    const arrDefinitions = await this.client.getQualityDefinitions();
    const desiredDefinitions = structuredClone(arrDefinitions);
    const arrDefMap = new Map<string, ArrQualityDefinition>();
    const desiredDefMap = new Map<string, ArrQualityDefinition>();
    for (let index = 0; index < arrDefinitions.length; index += 1) {
      const def = arrDefinitions[index];
      if (typeof def.quality?.name === 'string') {
        arrDefMap.set(def.quality.name.toLowerCase(), def);
        desiredDefMap.set(def.quality.name.toLowerCase(), desiredDefinitions[index]);
      }
    }

    const changes: EntityChange[] = [];
    const missingMappingEntries: string[] = [];
    const missingDefinitionEntries: string[] = [];
    const matchedRemoteIds: number[] = [];

    for (const entry of qualityDefsConfig.entries) {
      const apiName = apiMappings.get(entry.quality_name.toLowerCase());
      if (!apiName) {
        missingMappingEntries.push(entry.quality_name);
        continue;
      }

      if (instanceType === 'lidarr' && !isKnownQualityApiName('lidarr', apiName)) {
        missingMappingEntries.push(entry.quality_name);
        continue;
      }

      const arrDefinition = arrDefMap.get(apiName.toLowerCase());
      if (!arrDefinition) {
        missingDefinitionEntries.push(entry.quality_name);
        continue;
      }

      const desiredDefinitionTarget = desiredDefMap.get(apiName.toLowerCase());
      if (!desiredDefinitionTarget) {
        missingDefinitionEntries.push(entry.quality_name);
        continue;
      }

      const desiredDefinition = {
        ...arrDefinition,
        minSize: entry.min_size,
        maxSize: entry.max_size === 0 ? null : entry.max_size,
        preferredSize: entry.preferred_size === 0 ? null : entry.preferred_size,
      };
      desiredDefinitionTarget.minSize = desiredDefinition.minSize;
      desiredDefinitionTarget.maxSize = desiredDefinition.maxSize;
      desiredDefinitionTarget.preferredSize = desiredDefinition.preferredSize;
      matchedRemoteIds.push(arrDefinition.id);

      const change = diffSingletonEntity({
        entityType: 'qualityDefinition',
        name: entry.quality_name,
        desiredEntity: desiredDefinition as ArrQualityDefinition & Record<string, unknown>,
        currentEntity: arrDefinition as ArrQualityDefinition & Record<string, unknown>,
        currentComparable: (def) => ({
          minSize: def.minSize,
          maxSize: def.maxSize,
          preferredSize: def.preferredSize,
        }),
        desiredComparable: (def) => ({
          minSize: def.minSize,
          maxSize: def.maxSize,
          preferredSize: def.preferredSize,
        }),
        currentRemoteId: (def) => (def as ArrQualityDefinition).id,
      });

      if (change.action !== 'unchanged') {
        changes.push(change);
      }
    }

    review.arr.qualityDefinitionsCurrent = arrDefinitions;
    review.capabilities.qualityDefinitions = {
      definitions: arrDefinitions.map((definition) => ({
        id: definition.id,
        name: definition.quality?.name ?? null,
      })),
      matchedRemoteIds,
      missingMappings: [...missingMappingEntries].sort(),
      missingArrDefinitions: [...missingDefinitionEntries].sort(),
    };
    if (matchedRemoteIds.length > 0) {
      review.desired.qualityDefinitions = {
        name: configName,
        sourceKind: 'pcd',
        payload: desiredDefinitions,
        matchedRemoteIds,
      };
    }

    if (instanceType === 'lidarr' && (missingMappingEntries.length > 0 || missingDefinitionEntries.length > 0)) {
      await logger.warn('Skipped unsupported Lidarr quality definitions entries', {
        source: 'Preview:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          missingMappings: missingMappingEntries,
          missingArrDefinitions: missingDefinitionEntries,
          reason: LIDARR_QUALITY_SKIP_REASON,
          subsection: 'qualityDefinitions',
        },
      });
    }

    if (changes.length === 0) {
      await logger.debug('No quality definition changes found for preview', {
        source: 'Preview:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          missingMappings: missingMappingEntries,
          missingArrDefinitions: missingDefinitionEntries,
          subsection: 'qualityDefinitions',
        },
      });
    }

    return changes;
  }

  private async generateTrashNamingPreview(
    selection: { sourceId: number; itemName: string } | null,
    instanceType: SyncArrType,
    review: MediaManagementReviewAccumulator
  ): Promise<EntityChange | null> {
    if (!selection) return null;

    const source = trashGuideSourcesQueries.getById(selection.sourceId);
    const cached = trashGuideEntityCacheQueries
      .getBySourceAndType(selection.sourceId, 'naming')
      .find((entity) => entity.name === selection.itemName);
    if (!source || !cached || source.arr_type !== instanceType) {
      review.pcd.namingSource = { sourceKind: 'trash', selection, source: source ?? null, cached: cached ?? null };
      review.selections.naming = { sourceKind: 'trash', ...selection };
      review.capabilities.naming = {
        supported: false,
        sourceArrType: source?.arr_type ?? null,
        targetArrType: instanceType,
      };
      return null;
    }

    const entity = JSON.parse(cached.jsonData) as TrashGuideNamingEntity;
    const transformed = toPortableNaming(entity, source.arr_type);
    const expectedEntityType = `${instanceType}_naming`;
    if (transformed.portableEntityType !== expectedEntityType) {
      throw new Error('TRaSH naming source does not match the explicit target arr type.');
    }

    const current = (await this.client.getNamingConfig()) as Record<string, unknown>;
    let updates: Record<string, unknown>;
    if (transformed.portableEntityType === 'radarr_naming') {
      const portable = transformed.data;
      updates = {
        renameMovies: portable.rename,
        replaceIllegalCharacters: portable.replaceIllegalCharacters,
        colonReplacementFormat: portable.colonReplacementFormat,
        standardMovieFormat: portable.movieFormat,
        movieFolderFormat: portable.movieFolderFormat,
      };
    } else {
      const portable = transformed.data;
      updates = {
        renameEpisodes: portable.rename,
        replaceIllegalCharacters: portable.replaceIllegalCharacters,
        colonReplacementFormat: colonReplacementToDb(portable.colonReplacementFormat),
        customColonReplacementFormat: portable.customColonReplacementFormat,
        multiEpisodeStyle: multiEpisodeStyleToDb(portable.multiEpisodeStyle),
        standardEpisodeFormat: portable.standardEpisodeFormat,
        dailyEpisodeFormat: portable.dailyEpisodeFormat,
        animeEpisodeFormat: portable.animeEpisodeFormat,
        seriesFolderFormat: portable.seriesFolderFormat,
        seasonFolderFormat: portable.seasonFolderFormat,
      };
    }
    const desired = { ...current, ...updates };

    review.pcd.namingSource = {
      sourceKind: 'trash',
      selection,
      source,
      cacheIdentity: {
        id: cached.id,
        trashId: cached.trashId,
        contentHash: cached.contentHash,
        filePath: cached.filePath,
      },
      entity,
      transformed,
    };
    review.selections.naming = { sourceKind: 'trash', ...selection, arrType: source.arr_type };
    review.arr.namingCurrent = current;
    review.capabilities.naming = {
      supported: true,
      observedFields: Object.keys(current).sort(),
      appliedFields: Object.keys(updates).sort(),
    };
    review.desired.naming = {
      name: selection.itemName,
      sourceKind: 'trash',
      payload: desired,
      remoteId: readConfigId(current),
    };

    return diffSingletonEntity({
      entityType: 'naming',
      name: selection.itemName,
      desiredEntity: desired,
      currentEntity: current,
      currentRemoteId: (config) => (config as { id?: number | null }).id ?? null,
    });
  }

  private async generateTrashQualityDefinitionsPreview(
    selection: { sourceId: number; itemName: string } | null,
    instanceType: SyncArrType,
    review: MediaManagementReviewAccumulator
  ): Promise<readonly EntityChange[]> {
    if (!selection) return [];

    const source = trashGuideSourcesQueries.getById(selection.sourceId);
    const cached = trashGuideEntityCacheQueries
      .getBySourceAndType(selection.sourceId, 'quality_size')
      .find((entity) => entity.name === selection.itemName);
    if (!source || !cached || source.arr_type !== instanceType) {
      review.pcd.qualityDefinitionsSource = {
        sourceKind: 'trash',
        selection,
        source: source ?? null,
        cached: cached ?? null,
      };
      review.selections.qualityDefinitions = { sourceKind: 'trash', ...selection };
      review.capabilities.qualityDefinitions = {
        supported: false,
        sourceArrType: source?.arr_type ?? null,
        targetArrType: instanceType,
      };
      return [];
    }

    const entity = JSON.parse(cached.jsonData) as TrashGuideQualitySizeEntity;
    const transformed = toPortableQualityDefinitions(entity, source.arr_type);
    const current = await this.client.getQualityDefinitions();
    const desired = structuredClone(current);
    const desiredByName = new Map(
      desired.flatMap((definition) =>
        typeof definition.quality?.name === 'string'
          ? [[definition.quality.name.toLowerCase(), definition] as const]
          : []
      )
    );
    const currentByName = new Map(
      current.flatMap((definition) =>
        typeof definition.quality?.name === 'string'
          ? [[definition.quality.name.toLowerCase(), definition] as const]
          : []
      )
    );
    const changes: EntityChange[] = [];
    const matchedRemoteIds: number[] = [];
    const missingDefinitions: string[] = [];

    for (const entry of transformed.data.entries) {
      const desiredDefinition = desiredByName.get(entry.quality_name.toLowerCase());
      const currentDefinition = currentByName.get(entry.quality_name.toLowerCase());
      if (!desiredDefinition || !currentDefinition) {
        missingDefinitions.push(entry.quality_name);
        continue;
      }
      desiredDefinition.minSize = entry.min_size;
      desiredDefinition.maxSize = entry.max_size === 0 ? null : entry.max_size;
      desiredDefinition.preferredSize = entry.preferred_size === 0 ? null : entry.preferred_size;
      matchedRemoteIds.push(desiredDefinition.id);

      const change = diffSingletonEntity({
        entityType: 'qualityDefinition',
        name: entry.quality_name,
        desiredEntity: desiredDefinition as ArrQualityDefinition & Record<string, unknown>,
        currentEntity: currentDefinition as ArrQualityDefinition & Record<string, unknown>,
        currentComparable: (definition) => ({
          minSize: definition.minSize,
          maxSize: definition.maxSize,
          preferredSize: definition.preferredSize,
        }),
        desiredComparable: (definition) => ({
          minSize: definition.minSize,
          maxSize: definition.maxSize,
          preferredSize: definition.preferredSize,
        }),
        currentRemoteId: (definition) => (definition as ArrQualityDefinition).id,
      });
      if (change.action !== 'unchanged') changes.push(change);
    }

    review.pcd.qualityDefinitionsSource = {
      sourceKind: 'trash',
      selection,
      source,
      cacheIdentity: {
        id: cached.id,
        trashId: cached.trashId,
        contentHash: cached.contentHash,
        filePath: cached.filePath,
      },
      entity,
      transformed,
    };
    review.selections.qualityDefinitions = { sourceKind: 'trash', ...selection, arrType: source.arr_type };
    review.arr.qualityDefinitionsCurrent = current;
    review.capabilities.qualityDefinitions = {
      supported: true,
      definitions: current.map((definition) => ({ id: definition.id, name: definition.quality?.name ?? null })),
      matchedRemoteIds,
      missingDefinitions,
    };
    if (matchedRemoteIds.length > 0) {
      review.desired.qualityDefinitions = {
        name: selection.itemName,
        sourceKind: 'trash',
        payload: desired,
        matchedRemoteIds,
      };
    }

    return changes;
  }

  private resolveNamingSource(): NamingSource | null {
    if (this.instanceType === 'radarr') {
      return {
        getByName: getRadarrNaming,
        entityType: 'radarr_naming',
        toDesiredPayload: (naming) => {
          const radarrNaming = naming as RadarrNamingRow;
          return {
            renameMovies: radarrNaming.rename,
            replaceIllegalCharacters: radarrNaming.replace_illegal_characters,
            colonReplacementFormat: radarrNaming.colon_replacement_format,
            standardMovieFormat: radarrNaming.movie_format,
            movieFolderFormat: radarrNaming.movie_folder_format,
          };
        },
      };
    }

    if (this.instanceType === 'sonarr') {
      return {
        getByName: getSonarrNaming,
        entityType: 'sonarr_naming',
        toDesiredPayload: (naming) => {
          const sonarrNaming = naming as SonarrNamingRow;
          return {
            renameEpisodes: sonarrNaming.rename,
            replaceIllegalCharacters: sonarrNaming.replace_illegal_characters,
            colonReplacementFormat: colonReplacementToDb(sonarrNaming.colon_replacement_format),
            customColonReplacementFormat: sonarrNaming.custom_colon_replacement_format,
            multiEpisodeStyle: multiEpisodeStyleToDb(sonarrNaming.multi_episode_style),
            standardEpisodeFormat: sonarrNaming.standard_episode_format,
            dailyEpisodeFormat: sonarrNaming.daily_episode_format,
            animeEpisodeFormat: sonarrNaming.anime_episode_format,
            seriesFolderFormat: sonarrNaming.series_folder_format,
            seasonFolderFormat: sonarrNaming.season_folder_format,
          };
        },
      };
    }

    if (this.instanceType === 'lidarr') {
      return {
        getByName: getLidarrNaming,
        entityType: 'lidarr_naming',
        toDesiredPayload: (naming) => {
          const lidarrNaming = naming as LidarrNamingRow;
          return {
            renameTracks: lidarrNaming.rename,
            standardTrackFormat: lidarrNaming.standard_track_format,
            multiDiscTrackFormat: lidarrNaming.multi_disc_track_format,
            artistFolderFormat: lidarrNaming.artist_folder_format,
            replaceIllegalCharacters: lidarrNaming.replace_illegal_characters,
            colonReplacementFormat: colonReplacementToDb(lidarrNaming.colon_replacement_format),
          };
        },
      };
    }

    return null;
  }

  private getMediaManagementSyncConfig(): MediaManagementSyncConfig {
    const previewConfig = parseMediaManagementPreviewConfig(this.getPreviewConfig());
    if (previewConfig) {
      return previewConfig;
    }

    return arrSyncQueries.getMediaManagementSync(this.instanceId);
  }

  private getSyncArrType(): SyncArrType | null {
    if (this.instanceType === 'radarr' || this.instanceType === 'sonarr' || this.instanceType === 'lidarr') {
      return this.instanceType;
    }

    return null;
  }

  private assertMediaManagementSubsectionSupported(
    subsection: MediaManagementSubsection,
    instanceType: SyncArrType
  ): void {
    const reason = getUnsupportedMediaManagementSubsectionReason(instanceType, subsection);
    if (!reason) {
      return;
    }

    throw new Error(
      JSON.stringify({
        section: 'mediaManagement',
        subsection,
        code: 'unsupported_arr_type',
        reason,
      })
    );
  }

  protected get syncType(): string {
    return 'media management';
  }

  override async generatePreview(): Promise<Readonly<MediaManagementPreview>> {
    try {
      await logger.info(`Generating media management preview for "${this.instanceName}"`, {
        source: 'Preview:MediaManagement',
        meta: { instanceId: this.instanceId },
      });

      const instanceType = this.getSyncArrType();
      if (!instanceType) {
        await logger.warn('Media management preview unsupported for this arr type', {
          source: 'Preview:MediaManagement',
          meta: { instanceId: this.instanceId },
        });
        throw new Error(
          JSON.stringify({
            section: 'mediaManagement',
            code: 'unsupported_arr_type',
            reason: 'Media management preview is not supported for this arr instance type',
          })
        );
      }

      if (!isSyncSectionSupported(instanceType, 'mediaManagement')) {
        await logger.error(`Media management preview unsupported for ${instanceType}`, {
          source: 'Preview:MediaManagement',
          meta: { instanceId: this.instanceId, instanceType },
        });
        throw new Error(
          JSON.stringify({
            section: 'mediaManagement',
            code: 'unsupported_section',
            reason:
              getUnsupportedSyncSectionReason(instanceType, 'mediaManagement') ??
              `Media management preview is not supported for ${instanceType}`,
          })
        );
      }

      const syncConfig = this.getMediaManagementSyncConfig();
      const review = createReviewAccumulator(syncConfig, instanceType);

      const mediaSettings = await this.generateMediaSettingsPreview(
        syncConfig.mediaSettingsDatabaseId,
        syncConfig.mediaSettingsConfigName,
        instanceType,
        review
      );
      const naming =
        syncConfig.namingDatabaseId && syncConfig.namingConfigName
          ? await this.generateNamingPreview(
              syncConfig.namingDatabaseId,
              syncConfig.namingConfigName,
              instanceType,
              review
            )
          : await this.generateTrashNamingPreview(this.getTrashNamingSelection(), instanceType, review);
      const qualityDefinitions =
        syncConfig.qualityDefinitionsDatabaseId && syncConfig.qualityDefinitionsConfigName
          ? await this.generateQualityDefinitionsPreview(
              syncConfig.qualityDefinitionsDatabaseId,
              syncConfig.qualityDefinitionsConfigName,
              instanceType,
              review
            )
          : await this.generateTrashQualityDefinitionsPreview(
              this.getTrashQualityDefinitionsSelection(),
              instanceType,
              review
            );

      this.recordPreviewEvidence('mediaManagement', 'pcd', 'selection', review.pcd.selection);
      this.recordPreviewEvidence('mediaManagement', 'pcd', 'mediaSettingsSource', review.pcd.mediaSettingsSource);
      this.recordPreviewEvidence('mediaManagement', 'pcd', 'namingSource', review.pcd.namingSource);
      this.recordPreviewEvidence(
        'mediaManagement',
        'pcd',
        'qualityDefinitionsSource',
        review.pcd.qualityDefinitionsSource
      );
      this.recordPreviewEvidence('mediaManagement', 'pcd', 'qualityApiMappings', review.pcd.qualityApiMappings);
      this.recordPreviewEvidence('mediaManagement', 'pcd', 'transformedDesiredValues', review.desired);
      this.recordPreviewEvidence('mediaManagement', 'arr', 'target', review.arr.target);
      this.recordPreviewEvidence('mediaManagement', 'arr', 'mediaSettingsCurrent', review.arr.mediaSettingsCurrent);
      this.recordPreviewEvidence('mediaManagement', 'arr', 'namingCurrent', review.arr.namingCurrent);
      this.recordPreviewEvidence(
        'mediaManagement',
        'arr',
        'qualityDefinitionsCurrent',
        review.arr.qualityDefinitionsCurrent
      );
      this.recordPreviewEvidence('mediaManagement', 'arr', 'capabilities', review.capabilities);
      this.preparePreviewExecution({
        section: 'mediaManagement',
        config: syncConfig,
        desired: review.desired,
        materialPlan: {
          arrType: instanceType,
          subsectionOrder: ['mediaSettings', 'naming', 'qualityDefinitions'],
          selections: review.selections,
          capabilities: review.capabilities,
        },
        currentGuards: {
          mediaSettings: review.arr.mediaSettingsCurrent,
          naming: review.arr.namingCurrent,
          qualityDefinitions: review.arr.qualityDefinitionsCurrent,
        },
      } satisfies MediaManagementPreparedExecutionContext);

      await logger.info(`Generated media management preview for "${this.instanceName}"`, {
        source: 'Preview:MediaManagement',
        meta: {
          instanceId: this.instanceId,
          section: 'mediaManagement',
          mediaSettingsAction: mediaSettings?.action ?? null,
          namingAction: naming?.action ?? null,
          qualityDefinitionChanges: qualityDefinitions.length,
        },
      });

      return {
        section: 'mediaManagement',
        mediaSettings,
        naming,
        qualityDefinitions,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await logger.error(`Failed to generate media management preview for "${this.instanceName}"`, {
        source: 'Preview:MediaManagement',
        meta: { instanceId: this.instanceId, error: errorMsg },
      });

      throw error instanceof Error ? error : new Error(errorMsg);
    }
  }

  /**
   * Override sync to handle multiple config types
   */
  override async sync(): Promise<SyncResult> {
    const prepared = this.getPreparedExecutionContext<MediaManagementPreparedExecutionContext>();
    const syncConfig = prepared?.config ?? this.getMediaManagementSyncConfig();
    const arrType = this.getSyncArrType();
    let totalSynced = 0;
    const errors: string[] = [];
    const outcomes: SyncEntityOutcome[] = [];

    /**
     * Run one subsection write and fold its terminal result into totals + a single
     * confirmed outcome. `noop` emits nothing (nothing was attempted); a thrown Arr
     * write is caught here and classified via {@link sanitizeArrWriteError}.
     */
    const runSubsection = async (
      entityType: SyncOutcomeEntityType,
      name: string,
      run: () => Promise<MediaSubsectionResult>
    ): Promise<void> => {
      let res: MediaSubsectionResult;
      try {
        res = await run();
      } catch (error) {
        const { reason, protectedDetails } = sanitizeArrWriteError(error);
        errors.push(`${entityType}: ${reason}`);
        await logger.error(`Failed to sync ${entityType}`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, ...protectedDetails },
        });
        if (arrType) {
          outcomes.push({
            section: 'mediaManagement',
            arrType,
            entityType,
            name,
            action: 'update',
            status: 'failed',
            remoteId: null,
            reason,
          });
        }
        return;
      }

      if (res.status === 'noop') {
        return;
      }
      if (res.status === 'success') {
        totalSynced++;
      }
      if (res.status === 'failed' && res.reason) {
        errors.push(`${entityType}: ${res.reason}`);
      }
      if (arrType) {
        outcomes.push({
          section: 'mediaManagement',
          arrType,
          entityType,
          name,
          action: 'update',
          status: res.status,
          remoteId: res.remoteId ?? null,
          reason: res.status === 'success' ? null : (res.reason ?? null),
        });
      }
    };

    if (prepared) {
      if (!arrType || prepared.materialPlan.arrType !== arrType) {
        return {
          success: false,
          itemsSynced: 0,
          error: 'Prepared media-management context does not match the target arr type.',
          outcomes: [],
        };
      }

      const desired = prepared.desired;
      if (desired.mediaSettings) {
        await runSubsection('mediaSettings', desired.mediaSettings.name, () =>
          this.syncPreparedSingleton('mediaSettings', desired.mediaSettings!, prepared.currentGuards.mediaSettings)
        );
      }
      if (desired.naming) {
        await runSubsection('naming', desired.naming.name, () =>
          this.syncPreparedSingleton('naming', desired.naming!, prepared.currentGuards.naming)
        );
      }
      if (desired.qualityDefinitions) {
        await runSubsection('qualityDefinitions', desired.qualityDefinitions.name, () =>
          this.syncPreparedQualityDefinitions(desired.qualityDefinitions!, prepared.currentGuards.qualityDefinitions)
        );
      }

      const success = errors.length === 0;
      return {
        success,
        itemsSynced: totalSynced,
        error: errors.length > 0 ? errors.join('; ') : undefined,
        outcomes,
      };
    }

    let trashNamingSelection: { sourceId: number; itemName: string } | null = null;
    let trashQualityDefinitionsSelection: { sourceId: number; itemName: string } | null = null;
    let hasTrashNaming = false;
    let hasTrashQualityDefs = false;

    if (!syncConfig.namingDatabaseId) {
      try {
        trashNamingSelection = this.getTrashNamingSelection();
        hasTrashNaming = !!trashNamingSelection;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        await logger.error(`Failed to load TRaSH naming selection`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, error: msg },
        });
      }
    }

    if (!syncConfig.qualityDefinitionsDatabaseId) {
      try {
        trashQualityDefinitionsSelection = this.getTrashQualityDefinitionsSelection();
        hasTrashQualityDefs = !!trashQualityDefinitionsSelection;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        await logger.error(`Failed to load TRaSH quality-definition selection`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, error: msg },
        });
      }
    }

    await logger.info(`Starting media management sync for "${this.instanceName}"`, {
      source: 'Sync:MediaManagement',
      meta: {
        instanceId: this.instanceId,
        hasMediaSettings: !!syncConfig.mediaSettingsDatabaseId && !!syncConfig.mediaSettingsConfigName,
        hasNaming: !!syncConfig.namingDatabaseId && !!syncConfig.namingConfigName,
        hasQualityDefs: !!syncConfig.qualityDefinitionsDatabaseId && !!syncConfig.qualityDefinitionsConfigName,
        hasTrashNaming,
        hasTrashQualityDefs,
      },
    });

    // Sync media settings if configured (both database and config name required)
    if (syncConfig.mediaSettingsDatabaseId && syncConfig.mediaSettingsConfigName) {
      const databaseId = syncConfig.mediaSettingsDatabaseId;
      const configName = syncConfig.mediaSettingsConfigName;
      await runSubsection('mediaSettings', configName, () => this.syncMediaSettings(databaseId, configName));
    }

    // Sync naming: PCD first, TRaSH fallback
    if (syncConfig.namingDatabaseId && syncConfig.namingConfigName) {
      const databaseId = syncConfig.namingDatabaseId;
      const configName = syncConfig.namingConfigName;
      await runSubsection('naming', configName, () => this.syncNaming(databaseId, configName));
    } else {
      await runSubsection('naming', trashNamingSelection?.itemName ?? 'naming', () =>
        this.syncTrashNaming(trashNamingSelection)
      );
    }

    // Sync quality definitions: PCD first, TRaSH fallback
    if (syncConfig.qualityDefinitionsDatabaseId && syncConfig.qualityDefinitionsConfigName) {
      const databaseId = syncConfig.qualityDefinitionsDatabaseId;
      const configName = syncConfig.qualityDefinitionsConfigName;
      await runSubsection('qualityDefinitions', configName, () => this.syncQualityDefinitions(databaseId, configName));
    } else {
      await runSubsection(
        'qualityDefinitions',
        trashQualityDefinitionsSelection?.itemName ?? 'qualityDefinitions',
        () => this.syncTrashQualityDefinitions(trashQualityDefinitionsSelection)
      );
    }

    const success = errors.length === 0;
    const result: SyncResult = {
      success,
      itemsSynced: totalSynced,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      outcomes,
    };

    await logger.info(`Completed media management sync for "${this.instanceName}"`, {
      source: 'Sync:MediaManagement',
      meta: { instanceId: this.instanceId, ...result },
    });

    return result;
  }

  private async syncPreparedSingleton(
    subsection: 'mediaSettings' | 'naming',
    prepared: Readonly<PreparedMediaManagementWrite>,
    currentGuard: Readonly<Record<string, unknown>> | null
  ): Promise<MediaSubsectionResult> {
    const guardRemoteId = readConfigId(currentGuard);
    const payloadRemoteId = readConfigId(prepared.payload);
    if (guardRemoteId !== prepared.remoteId || payloadRemoteId !== prepared.remoteId) {
      return subFail('Prepared media-management identity guard is inconsistent.');
    }

    const payload = structuredClone(prepared.payload);
    if (subsection === 'mediaSettings') {
      await this.client.updateMediaManagementConfig(payload as unknown as ArrMediaManagementConfig);
    } else {
      await this.client.updateNamingConfig(payload as unknown as ArrNamingConfig);
    }
    return subOk(prepared.remoteId);
  }

  private async syncPreparedQualityDefinitions(
    prepared: Readonly<PreparedQualityDefinitionsWrite>,
    currentGuards: readonly ArrQualityDefinition[]
  ): Promise<MediaSubsectionResult> {
    const guardIds = currentGuards.map((definition) => definition.id);
    const payloadIds = prepared.payload.map((definition) => definition.id);
    if (JSON.stringify(guardIds) !== JSON.stringify(payloadIds)) {
      return subFail('Prepared quality-definition identity guards are inconsistent.');
    }

    await this.client.updateQualityDefinitions([...structuredClone(prepared.payload)]);
    return subOk(null);
  }

  // =========================================================================
  // Media Settings
  // =========================================================================

  private async syncMediaSettings(databaseId: number, configName: string): Promise<MediaSubsectionResult> {
    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Sync:MediaSettings',
        meta: { instanceId: this.instanceId },
      });
      // Source data unavailable (no Arr write attempted) → skipped, consistent across sections.
      return subSkip(`PCD cache not available for database ${databaseId}.`);
    }

    const mediaSettingsSource = this.resolveMediaSettingsSource();
    if (!mediaSettingsSource) {
      await logger.warn(`Unsupported instance type for media settings sync: ${this.instanceType}`, {
        source: 'Sync:MediaSettings',
        meta: { instanceId: this.instanceId },
      });
      return subFail('Media settings are not supported for this arr instance type.');
    }

    const mediaSettingsEntity = mediaSettingsSource.entityType;

    // Fetch from PCD by config name
    let mediaSettings: RadarrMediaSettingsRow | SonarrMediaSettingsRow | LidarrMediaSettingsRow | null = null;
    mediaSettings = await mediaSettingsSource.getByName(cache, configName);

    if (!mediaSettings) {
      await logger.debug(`Media settings config "${configName}" not found in ${mediaSettingsEntity}`, {
        source: 'Sync:MediaSettings',
        meta: {
          instanceId: this.instanceId,
          configName,
          entityType: mediaSettingsEntity,
        },
      });
      return subSkip(`Media settings config "${configName}" not found in its source database.`);
    }

    // GET existing config
    const existingConfig = await this.client.getMediaManagementConfig();
    const managedUpdates = {
      downloadPropersAndRepacks: this.mapPropersRepacks(mediaSettings.propers_repacks),
      enableMediaInfo: mediaSettings.enable_media_info,
    };

    let updatedConfig = {
      ...existingConfig,
      ...managedUpdates,
    };
    let appliedFields = Object.keys(managedUpdates);

    if (this.instanceType === 'lidarr') {
      const applied = this.applyConfigUpdates(existingConfig, managedUpdates);
      updatedConfig = applied.updatedConfig;
      appliedFields = applied.appliedFields;

      if (applied.missingFields.length > 0) {
        await logger.warn('Skipping unsupported Lidarr media settings fields', {
          source: 'Sync:MediaSettings',
          meta: {
            instanceId: this.instanceId,
            configName,
            missingFields: applied.missingFields,
            reason: LIDARR_UNSUPPORTED_FIELD_REASON,
          },
        });
      }

      if (appliedFields.length === 0) {
        await logger.warn('No supported Lidarr media settings fields available to sync', {
          source: 'Sync:MediaSettings',
          meta: {
            instanceId: this.instanceId,
            configName,
            reason: LIDARR_UNSUPPORTED_FIELD_REASON,
          },
        });
        return subSkip(LIDARR_UNSUPPORTED_FIELD_REASON);
      }

      const unchangedFields = this.getUnmanagedConfigFields(existingConfig, [
        'downloadPropersAndRepacks',
        'enableMediaInfo',
      ]);
      if (unchangedFields.length > 0) {
        await logger.debug('Leaving unsupported Lidarr media settings fields unchanged', {
          source: 'Sync:MediaSettings',
          meta: {
            instanceId: this.instanceId,
            configName,
            unchangedFields,
            reason: LIDARR_UNSUPPORTED_FIELD_REASON,
          },
        });
      }
    }

    await logger.debug('Updating media settings', {
      source: 'Sync:MediaSettings',
      meta: {
        instanceId: this.instanceId,
        configName,
        propersRepacks: managedUpdates.downloadPropersAndRepacks,
        enableMediaInfo: managedUpdates.enableMediaInfo,
        appliedFields,
      },
    });

    await this.client.updateMediaManagementConfig(updatedConfig);
    return subOk(readConfigId(existingConfig));
  }

  private mapPropersRepacks(pcdValue: string): ArrPropersAndRepacks {
    const mapping: Record<string, ArrPropersAndRepacks> = {
      doNotPrefer: 'doNotPrefer',
      preferAndUpgrade: 'preferAndUpgrade',
      doNotUpgradeAutomatically: 'doNotUpgrade',
    };
    return mapping[pcdValue] ?? 'doNotPrefer';
  }

  // =========================================================================
  // Naming
  // =========================================================================

  private async syncNaming(databaseId: number, configName: string): Promise<MediaSubsectionResult> {
    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId },
      });
      // Source data unavailable (no Arr write attempted) → skipped, consistent across sections.
      return subSkip(`PCD cache not available for database ${databaseId}.`);
    }

    if (this.instanceType === 'radarr') {
      return this.syncRadarrNaming(cache, configName);
    } else if (this.instanceType === 'sonarr') {
      return this.syncSonarrNaming(cache, configName);
    } else if (this.instanceType === 'lidarr') {
      return this.syncLidarrNaming(cache, configName);
    }

    await logger.warn(`Unsupported instance type for naming sync: ${this.instanceType}`, {
      source: 'Sync:Naming',
      meta: { instanceId: this.instanceId },
    });
    return subFail('Naming is not supported for this arr instance type.');
  }

  private async syncRadarrNaming(cache: PCDCache, configName: string): Promise<MediaSubsectionResult> {
    const naming = await getRadarrNaming(cache, configName);
    if (!naming) {
      await logger.debug(`Radarr naming config "${configName}" not found in PCD`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, configName },
      });
      return subSkip(`Radarr naming config "${configName}" not found in its source database.`);
    }

    // GET existing config
    const existingConfig = (await this.client.getNamingConfig()) as RadarrNamingConfig;

    // Transform and update
    const updatedConfig: RadarrNamingConfig = {
      ...existingConfig,
      renameMovies: naming.rename,
      replaceIllegalCharacters: naming.replace_illegal_characters,
      colonReplacementFormat: naming.colon_replacement_format,
      standardMovieFormat: naming.movie_format,
      movieFolderFormat: naming.movie_folder_format,
    };

    await logger.debug('Updating Radarr naming', {
      source: 'Sync:Naming',
      meta: {
        instanceId: this.instanceId,
        configName,
        renameMovies: updatedConfig.renameMovies,
        colonReplacementFormat: updatedConfig.colonReplacementFormat,
      },
    });

    await this.client.updateNamingConfig(updatedConfig);
    return subOk(readConfigId(existingConfig));
  }

  private async syncLidarrNaming(cache: PCDCache, configName: string): Promise<MediaSubsectionResult> {
    const naming = await getLidarrNaming(cache, configName);
    if (!naming) {
      await logger.debug(`Lidarr naming config "${configName}" not found in lidarr_naming`, {
        source: 'Sync:Naming',
        meta: {
          instanceId: this.instanceId,
          configName,
          entityType: 'lidarr_naming',
        },
      });
      return subSkip(`Lidarr naming config "${configName}" not found in its source database.`);
    }

    const existingConfig = await this.client.getNamingConfig();
    const lidarrUpdates = {
      renameTracks: naming.rename,
      standardTrackFormat: naming.standard_track_format,
      multiDiscTrackFormat: naming.multi_disc_track_format,
      artistFolderFormat: naming.artist_folder_format,
      replaceIllegalCharacters: naming.replace_illegal_characters,
      colonReplacementFormat: colonReplacementToDb(naming.colon_replacement_format),
    };
    const { updatedConfig, appliedFields, missingFields } = this.applyConfigUpdates(existingConfig, lidarrUpdates);

    if (missingFields.length > 0) {
      await logger.warn('Skipping unsupported Lidarr naming target fields', {
        source: 'Sync:Naming',
        meta: {
          instanceId: this.instanceId,
          configName,
          missingFields,
          reason: LIDARR_UNSUPPORTED_FIELD_REASON,
        },
      });
    }

    await logger.debug('Skipping unsupported Lidarr naming source fields', {
      source: 'Sync:Naming',
      meta: {
        instanceId: this.instanceId,
        configName,
        skippedFields: [...LIDARR_UNSUPPORTED_NAMING_SOURCE_FIELDS],
        reason: LIDARR_NAMING_SOURCE_FIELD_REASON,
      },
    });

    if (appliedFields.length === 0) {
      await logger.warn('No supported Lidarr naming fields available to sync', {
        source: 'Sync:Naming',
        meta: {
          instanceId: this.instanceId,
          configName,
          reason: LIDARR_UNSUPPORTED_FIELD_REASON,
        },
      });
      return subSkip(LIDARR_UNSUPPORTED_FIELD_REASON);
    }

    const unchangedFields = this.getUnmanagedConfigFields(existingConfig, [
      'renameTracks',
      'standardTrackFormat',
      'multiDiscTrackFormat',
      'artistFolderFormat',
      'replaceIllegalCharacters',
      'colonReplacementFormat',
    ]);
    if (unchangedFields.length > 0) {
      await logger.debug('Leaving unsupported Lidarr naming fields unchanged', {
        source: 'Sync:Naming',
        meta: {
          instanceId: this.instanceId,
          configName,
          unchangedFields,
          reason: LIDARR_UNSUPPORTED_FIELD_REASON,
        },
      });
    }

    await logger.debug('Updating Lidarr naming', {
      source: 'Sync:Naming',
      meta: {
        instanceId: this.instanceId,
        configName,
        appliedFields,
      },
    });

    await this.client.updateNamingConfig(updatedConfig);
    return subOk(readConfigId(existingConfig));
  }

  private async syncSonarrNaming(cache: PCDCache, configName: string): Promise<MediaSubsectionResult> {
    const naming = await getSonarrNaming(cache, configName);
    if (!naming) {
      await logger.debug(`Sonarr naming config "${configName}" not found in PCD`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, configName },
      });
      return subSkip(`Sonarr naming config "${configName}" not found in its source database.`);
    }

    // GET existing config
    const existingConfig = (await this.client.getNamingConfig()) as SonarrNamingConfig;

    // Transform and update - Sonarr uses integers for enums
    const updatedConfig: SonarrNamingConfig = {
      ...existingConfig,
      renameEpisodes: naming.rename,
      replaceIllegalCharacters: naming.replace_illegal_characters,
      colonReplacementFormat: colonReplacementToDb(naming.colon_replacement_format),
      customColonReplacementFormat: naming.custom_colon_replacement_format,
      multiEpisodeStyle: multiEpisodeStyleToDb(naming.multi_episode_style),
      standardEpisodeFormat: naming.standard_episode_format,
      dailyEpisodeFormat: naming.daily_episode_format,
      animeEpisodeFormat: naming.anime_episode_format,
      seriesFolderFormat: naming.series_folder_format,
      seasonFolderFormat: naming.season_folder_format,
    };

    await logger.debug('Updating Sonarr naming', {
      source: 'Sync:Naming',
      meta: {
        instanceId: this.instanceId,
        configName,
        renameEpisodes: updatedConfig.renameEpisodes,
        colonReplacementFormat: updatedConfig.colonReplacementFormat,
        multiEpisodeStyle: updatedConfig.multiEpisodeStyle,
      },
    });

    await this.client.updateNamingConfig(updatedConfig);
    return subOk(readConfigId(existingConfig));
  }

  // =========================================================================
  // Quality Definitions
  // =========================================================================

  private async syncQualityDefinitions(databaseId: number, configName: string): Promise<MediaSubsectionResult> {
    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId },
      });
      // Source data unavailable (no Arr write attempted) → skipped, consistent across sections.
      return subSkip(`PCD cache not available for database ${databaseId}.`);
    }

    const qualityDefinitionsSource = this.resolveQualityDefinitionsSource();
    if (!qualityDefinitionsSource) {
      await logger.warn(`Unsupported instance type for quality definitions sync: ${this.instanceType}`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId },
      });
      return subFail('Quality definitions are not supported for this arr instance type.');
    }

    const qualityDefinitionsEntity = qualityDefinitionsSource.entityType;
    const getByName = qualityDefinitionsSource.getByName;
    const qualityDefsConfig = await getByName(cache, configName);

    if (!qualityDefsConfig) {
      await logger.debug(`Quality definitions config "${configName}" not found in ${qualityDefinitionsEntity}`, {
        source: 'Sync:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          entityType: qualityDefinitionsEntity,
        },
      });
      return subSkip(`Quality definitions config "${configName}" not found in its source database.`);
    }

    if (qualityDefsConfig.entries.length === 0) {
      await logger.debug(`Quality definitions config "${configName}" has no entries`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, configName },
      });
      return subSkip(`Quality definitions config "${configName}" has no entries.`);
    }

    // Get quality API mappings from PCD (maps quality_name -> api_name)
    const apiMappings = await this.getQualityApiMappings(cache);
    if (this.instanceType === 'lidarr' && apiMappings.size === 0) {
      await logger.warn('Skipping Lidarr quality definitions sync due missing mappings', {
        source: 'Sync:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          reason: LIDARR_QUALITY_SKIP_REASON,
        },
      });
      return subSkip(LIDARR_QUALITY_SKIP_REASON);
    }

    // GET existing quality definitions from ARR
    const arrDefinitions = await this.client.getQualityDefinitions();

    // Build map of ARR quality name (lowercase) -> definition
    const arrDefMap = new Map<string, (typeof arrDefinitions)[0]>();
    for (const def of arrDefinitions) {
      if (def.quality.name) {
        arrDefMap.set(def.quality.name.toLowerCase(), def);
      }
    }

    // Update ARR definitions with PCD values
    let updatedCount = 0;
    const missingMappingEntries: string[] = [];
    const missingDefinitionEntries: string[] = [];
    for (const entry of qualityDefsConfig.entries) {
      // Get the API name for this quality
      const apiName = apiMappings.get(entry.quality_name.toLowerCase());
      if (!apiName) {
        missingMappingEntries.push(entry.quality_name);
        if (this.instanceType !== 'lidarr') {
          await logger.debug(`No API mapping found for quality "${entry.quality_name}"`, {
            source: 'Sync:QualityDefinitions',
            meta: {
              instanceId: this.instanceId,
              qualityName: entry.quality_name,
            },
          });
        }
        continue;
      }

      // Find matching ARR definition
      const arrDef = arrDefMap.get(apiName.toLowerCase());
      if (!arrDef) {
        missingDefinitionEntries.push(entry.quality_name);
        if (this.instanceType !== 'lidarr') {
          await logger.debug(`No ARR definition found for quality "${apiName}"`, {
            source: 'Sync:QualityDefinitions',
            meta: { instanceId: this.instanceId, apiName },
          });
        }
        continue;
      }

      if (this.instanceType === 'lidarr' && !isKnownQualityApiName('lidarr', apiName)) {
        missingMappingEntries.push(entry.quality_name);
        continue;
      }

      // Update the definition
      // PCD stores 0 for "unlimited", arr API expects null
      arrDef.minSize = entry.min_size;
      arrDef.maxSize = entry.max_size === 0 ? null : entry.max_size;
      arrDef.preferredSize = entry.preferred_size === 0 ? null : entry.preferred_size;
      updatedCount++;
    }

    missingMappingEntries.sort();
    missingDefinitionEntries.sort();
    if (this.instanceType === 'lidarr' && (missingMappingEntries.length > 0 || missingDefinitionEntries.length > 0)) {
      await logger.warn('Skipped unsupported Lidarr quality definitions entries', {
        source: 'Sync:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          missingMappings: missingMappingEntries,
          missingArrDefinitions: missingDefinitionEntries,
          reason: LIDARR_QUALITY_SKIP_REASON,
        },
      });
    }

    if (updatedCount === 0) {
      await logger.debug('No quality definitions matched for update', {
        source: 'Sync:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          missingMappings: missingMappingEntries,
          missingArrDefinitions: missingDefinitionEntries,
        },
      });
      return subSkip('No quality definitions matched between the source config and this instance.');
    }

    await logger.debug(`Updating ${updatedCount} quality definitions`, {
      source: 'Sync:QualityDefinitions',
      meta: {
        instanceId: this.instanceId,
        configName,
        updatedCount,
        missingMappings: missingMappingEntries,
        missingArrDefinitions: missingDefinitionEntries,
      },
    });

    // PUT the full array back (bulk write → one subsection outcome, no per-quality remote id)
    await this.client.updateQualityDefinitions(arrDefinitions);
    return subOk(null);
  }

  private getQualityApiMappings(cache: PCDCache): Promise<Map<string, string>> {
    if (this.instanceType === 'radarr' || this.instanceType === 'sonarr' || this.instanceType === 'lidarr') {
      return getQualityApiMappings(cache, this.instanceType).then((lookup) => lookup.qualityToApiName);
    }
    return Promise.resolve(new Map<string, string>());
  }

  private resolveMediaSettingsSource(): {
    getByName: (
      cache: PCDCache,
      configName: string
    ) => Promise<RadarrMediaSettingsRow | SonarrMediaSettingsRow | LidarrMediaSettingsRow | null>;
    entityType: 'radarr_media_settings' | 'sonarr_media_settings' | 'lidarr_media_settings';
  } | null {
    if (this.instanceType === 'radarr') {
      return {
        getByName: getRadarrMediaSettings,
        entityType: 'radarr_media_settings',
      };
    }

    if (this.instanceType === 'sonarr') {
      return {
        getByName: getSonarrMediaSettings,
        entityType: 'sonarr_media_settings',
      };
    }

    if (this.instanceType === 'lidarr') {
      return {
        getByName: getLidarrMediaSettings,
        entityType: 'lidarr_media_settings',
      };
    }

    return null;
  }

  private resolveQualityDefinitionsSource(): {
    getByName: (cache: PCDCache, configName: string) => Promise<QualityDefinitionsConfig | null>;
    entityType: 'radarr_quality_definitions' | 'sonarr_quality_definitions' | 'lidarr_quality_definitions';
  } | null {
    if (this.instanceType === 'radarr') {
      return {
        getByName: getRadarrQualityDefs,
        entityType: 'radarr_quality_definitions',
      };
    }

    if (this.instanceType === 'sonarr') {
      return {
        getByName: getSonarrQualityDefs,
        entityType: 'sonarr_quality_definitions',
      };
    }

    if (this.instanceType === 'lidarr') {
      return {
        getByName: getLidarrQualityDefs,
        entityType: 'lidarr_quality_definitions',
      };
    }

    return null;
  }

  private applyConfigUpdates<TConfig extends Record<string, unknown>>(
    existingConfig: TConfig,
    updates: Record<string, unknown>
  ): {
    updatedConfig: TConfig;
    appliedFields: string[];
    missingFields: string[];
  } {
    const updatedConfig: Record<string, unknown> = { ...existingConfig };
    const appliedFields: string[] = [];
    const missingFields: string[] = [];

    for (const [field, value] of Object.entries(updates)) {
      if (Object.hasOwn(existingConfig, field)) {
        updatedConfig[field] = value;
        appliedFields.push(field);
      } else {
        missingFields.push(field);
      }
    }

    appliedFields.sort();
    missingFields.sort();

    return {
      updatedConfig: updatedConfig as TConfig,
      appliedFields,
      missingFields,
    };
  }

  private getUnmanagedConfigFields(existingConfig: Record<string, unknown>, managedFields: string[]): string[] {
    const managed = new Set(['id', ...managedFields]);
    return Object.keys(existingConfig)
      .filter((field) => !managed.has(field))
      .sort();
  }

  // =========================================================================
  // TRaSH Guide Naming
  // =========================================================================

  private getTrashNamingSelection(): { sourceId: number; itemName: string } | null {
    const selections = trashGuideSyncQueries.getSelectionsByInstance(this.instanceId);
    const namingSel = selections.find((s) => s.sectionType === 'naming');
    if (!namingSel) return null;
    return { sourceId: namingSel.sourceId, itemName: namingSel.itemName };
  }

  private getTrashQualityDefinitionsSelection(): { sourceId: number; itemName: string } | null {
    const selections = trashGuideSyncQueries.getSelectionsByInstance(this.instanceId);
    const qdSel = selections.find((s) => s.sectionType === 'qualityDefinitions');
    if (!qdSel) return null;
    return { sourceId: qdSel.sourceId, itemName: qdSel.itemName };
  }

  private async syncTrashNaming(
    selection: { sourceId: number; itemName: string } | null
  ): Promise<MediaSubsectionResult> {
    if (!selection) return subNoop();

    const source = trashGuideSourcesQueries.getById(selection.sourceId);
    if (!source) {
      await logger.warn(`TRaSH source ${selection.sourceId} not found for naming sync`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId },
      });
      return subFail(`TRaSH source ${selection.sourceId} is no longer available.`);
    }
    if (source.arr_type !== this.instanceType) {
      return subSkip('TRaSH naming source does not match this explicit arr target.');
    }

    const cachedEntities = trashGuideEntityCacheQueries.getBySourceAndType(selection.sourceId, 'naming');
    const cached = cachedEntities.find((e) => e.name === selection.itemName);
    if (!cached) {
      await logger.warn(`TRaSH naming entity "${selection.itemName}" not found in cache`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId, itemName: selection.itemName },
      });
      return subFail(`TRaSH naming entity "${selection.itemName}" is not in the local cache.`);
    }

    const entity = JSON.parse(cached.jsonData) as TrashGuideNamingEntity;
    const arrType = source.arr_type as TrashGuideSupportedArrType;
    const result = toPortableNaming(entity, arrType);

    if (result.portableEntityType === 'radarr_naming') {
      const portable = result.data;
      const existingConfig = (await this.client.getNamingConfig()) as RadarrNamingConfig;
      const updatedConfig: RadarrNamingConfig = {
        ...existingConfig,
        renameMovies: portable.rename,
        replaceIllegalCharacters: portable.replaceIllegalCharacters,
        colonReplacementFormat: portable.colonReplacementFormat,
        standardMovieFormat: portable.movieFormat,
        movieFolderFormat: portable.movieFolderFormat,
      };

      await logger.debug('Updating Radarr naming from TRaSH', {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, trashEntity: entity.name },
      });

      await this.client.updateNamingConfig(updatedConfig);
      return subOk(readConfigId(existingConfig));
    }

    if (result.portableEntityType === 'sonarr_naming') {
      const portable = result.data;
      const existingConfig = (await this.client.getNamingConfig()) as SonarrNamingConfig;
      const updatedConfig: SonarrNamingConfig = {
        ...existingConfig,
        renameEpisodes: portable.rename,
        replaceIllegalCharacters: portable.replaceIllegalCharacters,
        colonReplacementFormat: colonReplacementToDb(portable.colonReplacementFormat),
        customColonReplacementFormat: portable.customColonReplacementFormat,
        multiEpisodeStyle: multiEpisodeStyleToDb(portable.multiEpisodeStyle),
        standardEpisodeFormat: portable.standardEpisodeFormat,
        dailyEpisodeFormat: portable.dailyEpisodeFormat,
        animeEpisodeFormat: portable.animeEpisodeFormat,
        seriesFolderFormat: portable.seriesFolderFormat,
        seasonFolderFormat: portable.seasonFolderFormat,
      };

      await logger.debug('Updating Sonarr naming from TRaSH', {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, trashEntity: entity.name },
      });

      await this.client.updateNamingConfig(updatedConfig);
      return subOk(readConfigId(existingConfig));
    }

    return subSkip('TRaSH naming is not supported for this arr instance type.');
  }

  // =========================================================================
  // TRaSH Guide Quality Definitions
  // =========================================================================

  private async syncTrashQualityDefinitions(
    selection: { sourceId: number; itemName: string } | null
  ): Promise<MediaSubsectionResult> {
    if (!selection) return subNoop();

    const source = trashGuideSourcesQueries.getById(selection.sourceId);
    if (!source) {
      await logger.warn(`TRaSH source ${selection.sourceId} not found for quality definitions sync`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId },
      });
      return subFail(`TRaSH source ${selection.sourceId} is no longer available.`);
    }
    if (source.arr_type !== this.instanceType) {
      return subSkip('TRaSH quality-definition source does not match this explicit arr target.');
    }

    const cachedEntities = trashGuideEntityCacheQueries.getBySourceAndType(selection.sourceId, 'quality_size');
    const cached = cachedEntities.find((e) => e.name === selection.itemName);
    if (!cached) {
      await logger.warn(`TRaSH quality_size entity "${selection.itemName}" not found in cache`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId, itemName: selection.itemName },
      });
      return subFail(`TRaSH quality definition "${selection.itemName}" is not in the local cache.`);
    }

    const entity = JSON.parse(cached.jsonData) as TrashGuideQualitySizeEntity;
    const arrType = source.arr_type as TrashGuideSupportedArrType;
    const result = toPortableQualityDefinitions(entity, arrType);

    if (result.data.entries.length === 0) {
      await logger.debug(`TRaSH quality definitions "${entity.name}" has no entries`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, entityName: entity.name },
      });
      return subSkip(`TRaSH quality definition "${entity.name}" has no entries.`);
    }

    // GET existing quality definitions from Arr
    const arrDefinitions = await this.client.getQualityDefinitions();
    const arrDefMap = new Map<string, (typeof arrDefinitions)[0]>();
    for (const def of arrDefinitions) {
      if (def.quality.name) {
        arrDefMap.set(def.quality.name.toLowerCase(), def);
      }
    }

    // TRaSH transformer already resolves quality names to canonical API names
    let updatedCount = 0;
    for (const entry of result.data.entries) {
      const arrDef = arrDefMap.get(entry.quality_name.toLowerCase());
      if (!arrDef) {
        await logger.debug(`No Arr definition found for TRaSH quality "${entry.quality_name}"`, {
          source: 'Sync:QualityDefinitions',
          meta: { instanceId: this.instanceId, qualityName: entry.quality_name },
        });
        continue;
      }

      arrDef.minSize = entry.min_size;
      arrDef.maxSize = entry.max_size === 0 ? null : entry.max_size;
      arrDef.preferredSize = entry.preferred_size === 0 ? null : entry.preferred_size;
      updatedCount++;
    }

    if (updatedCount === 0) {
      await logger.debug('No TRaSH quality definitions matched for update', {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, entityName: entity.name },
      });
      return subSkip('No TRaSH quality definitions matched the definitions on this instance.');
    }

    await logger.debug(`Updating ${updatedCount} quality definitions from TRaSH`, {
      source: 'Sync:QualityDefinitions',
      meta: { instanceId: this.instanceId, entityName: entity.name, updatedCount },
    });

    await this.client.updateQualityDefinitions(arrDefinitions);
    return subOk(null);
  }

  // =========================================================================
  // Base class abstract methods (not used since we override sync())
  // =========================================================================

  protected async fetchFromPcd(): Promise<unknown[]> {
    return [];
  }

  protected transformToArr(_pcdData: unknown[]): unknown[] {
    void _pcdData;
    return [];
  }

  protected async pushToArr(_arrData: unknown[]): Promise<void> {
    void _arrData;
    // Not used
  }
}
