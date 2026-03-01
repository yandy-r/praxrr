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
import type { EntityChange, MediaManagementPreview } from '../preview/types.ts';
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

interface MediaManagementSyncConfig {
  namingDatabaseId: number | null;
  namingConfigName: string | null;
  qualityDefinitionsDatabaseId: number | null;
  qualityDefinitionsConfigName: string | null;
  mediaSettingsDatabaseId: number | null;
  mediaSettingsConfigName: string | null;
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
    instanceType: SyncArrType
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

    const existingConfig = (await this.client.getMediaManagementConfig()) as ArrMediaManagementConfig;
    const managedUpdates = {
      downloadPropersAndRepacks: this.mapPropersRepacks(mediaSettings.propers_repacks),
      enableMediaInfo: mediaSettings.enable_media_info,
    };

    let updatedConfig: ArrMediaManagementConfig = {
      ...existingConfig,
      ...managedUpdates,
    };
    if (this.instanceType === 'lidarr') {
      const applied = this.applyConfigUpdates(existingConfig, managedUpdates);
      updatedConfig = applied.updatedConfig;
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
    instanceType: SyncArrType
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

    const existingConfig = (await this.client.getNamingConfig()) as ArrNamingConfig;
    const previewConfig = namingSource.toDesiredPayload(namingConfig);
    const currentConfig = existingConfig as Record<string, unknown>;
    let finalConfig: Record<string, unknown> = {
      ...currentConfig,
      ...previewConfig,
    };

    if (this.instanceType === 'lidarr') {
      const applied = this.applyConfigUpdates(currentConfig, previewConfig);
      finalConfig = {
        ...currentConfig,
        ...applied.updatedConfig,
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
    instanceType: SyncArrType
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

    if (qualityDefsConfig.entries.length === 0) {
      await logger.debug(`Quality definitions config "${configName}" has no entries`, {
        source: 'Preview:QualityDefinitions',
        meta: { instanceId: this.instanceId, configName, subsection: 'qualityDefinitions' },
      });
      return [];
    }

    const apiMappings = await this.getQualityApiMappings(cache);
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
    const arrDefMap = new Map<string, ArrQualityDefinition>();
    for (const def of arrDefinitions) {
      if (typeof def.quality?.name === 'string') {
        arrDefMap.set(def.quality.name.toLowerCase(), def);
      }
    }

    const changes: EntityChange[] = [];
    const missingMappingEntries: string[] = [];
    const missingDefinitionEntries: string[] = [];

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

      const desiredDefinition = {
        ...arrDefinition,
        minSize: entry.min_size,
        maxSize: entry.max_size === 0 ? null : entry.max_size,
        preferredSize: entry.preferred_size === 0 ? null : entry.preferred_size,
      };

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

      const mediaSettings = await this.generateMediaSettingsPreview(
        syncConfig.mediaSettingsDatabaseId,
        syncConfig.mediaSettingsConfigName,
        instanceType
      );
      const naming = await this.generateNamingPreview(
        syncConfig.namingDatabaseId,
        syncConfig.namingConfigName,
        instanceType
      );
      const qualityDefinitions = await this.generateQualityDefinitionsPreview(
        syncConfig.qualityDefinitionsDatabaseId,
        syncConfig.qualityDefinitionsConfigName,
        instanceType
      );

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
    const syncConfig = arrSyncQueries.getMediaManagementSync(this.instanceId);
    let totalSynced = 0;
    const errors: string[] = [];

    const hasTrashNaming = !syncConfig.namingDatabaseId && !!this.getTrashNamingSelection();
    const hasTrashQualityDefs =
      !syncConfig.qualityDefinitionsDatabaseId && !!this.getTrashQualityDefinitionsSelection();

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
      try {
        const synced = await this.syncMediaSettings(
          syncConfig.mediaSettingsDatabaseId,
          syncConfig.mediaSettingsConfigName
        );
        if (synced) totalSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Media settings: ${msg}`);
        await logger.error(`Failed to sync media settings`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, error: msg },
        });
      }
    }

    // Sync naming: PCD first, TRaSH fallback
    if (syncConfig.namingDatabaseId && syncConfig.namingConfigName) {
      try {
        const synced = await this.syncNaming(syncConfig.namingDatabaseId, syncConfig.namingConfigName);
        if (synced) totalSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Naming: ${msg}`);
        await logger.error(`Failed to sync naming`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, error: msg },
        });
      }
    } else {
      try {
        const synced = await this.syncTrashNaming();
        if (synced) totalSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Naming (TRaSH): ${msg}`);
        await logger.error(`Failed to sync TRaSH naming`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, error: msg },
        });
      }
    }

    // Sync quality definitions: PCD first, TRaSH fallback
    if (syncConfig.qualityDefinitionsDatabaseId && syncConfig.qualityDefinitionsConfigName) {
      try {
        const synced = await this.syncQualityDefinitions(
          syncConfig.qualityDefinitionsDatabaseId,
          syncConfig.qualityDefinitionsConfigName
        );
        if (synced) totalSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Quality definitions: ${msg}`);
        await logger.error(`Failed to sync quality definitions`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, error: msg },
        });
      }
    } else {
      try {
        const synced = await this.syncTrashQualityDefinitions();
        if (synced) totalSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Quality definitions (TRaSH): ${msg}`);
        await logger.error(`Failed to sync TRaSH quality definitions`, {
          source: 'Sync:MediaManagement',
          meta: { instanceId: this.instanceId, error: msg },
        });
      }
    }

    const success = errors.length === 0;
    const result: SyncResult = {
      success,
      itemsSynced: totalSynced,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };

    await logger.info(`Completed media management sync for "${this.instanceName}"`, {
      source: 'Sync:MediaManagement',
      meta: { instanceId: this.instanceId, ...result },
    });

    return result;
  }

  // =========================================================================
  // Media Settings
  // =========================================================================

  private async syncMediaSettings(databaseId: number, configName: string): Promise<boolean> {
    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Sync:MediaSettings',
        meta: { instanceId: this.instanceId },
      });
      return false;
    }

    const mediaSettingsSource = this.resolveMediaSettingsSource();
    if (!mediaSettingsSource) {
      await logger.warn(`Unsupported instance type for media settings sync: ${this.instanceType}`, {
        source: 'Sync:MediaSettings',
        meta: { instanceId: this.instanceId },
      });
      return false;
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
      return false;
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
        return false;
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
    return true;
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

  private async syncNaming(databaseId: number, configName: string): Promise<boolean> {
    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId },
      });
      return false;
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
    return false;
  }

  private async syncRadarrNaming(cache: PCDCache, configName: string): Promise<boolean> {
    const naming = await getRadarrNaming(cache, configName);
    if (!naming) {
      await logger.debug(`Radarr naming config "${configName}" not found in PCD`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, configName },
      });
      return false;
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
    return true;
  }

  private async syncLidarrNaming(cache: PCDCache, configName: string): Promise<boolean> {
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
      return false;
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
      return false;
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
    return true;
  }

  private async syncSonarrNaming(cache: PCDCache, configName: string): Promise<boolean> {
    const naming = await getSonarrNaming(cache, configName);
    if (!naming) {
      await logger.debug(`Sonarr naming config "${configName}" not found in PCD`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, configName },
      });
      return false;
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
    return true;
  }

  // =========================================================================
  // Quality Definitions
  // =========================================================================

  private async syncQualityDefinitions(databaseId: number, configName: string): Promise<boolean> {
    const cache = getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId },
      });
      return false;
    }

    const qualityDefinitionsSource = this.resolveQualityDefinitionsSource();
    if (!qualityDefinitionsSource) {
      await logger.warn(`Unsupported instance type for quality definitions sync: ${this.instanceType}`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId },
      });
      return false;
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
      return false;
    }

    if (qualityDefsConfig.entries.length === 0) {
      await logger.debug(`Quality definitions config "${configName}" has no entries`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, configName },
      });
      return false;
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
      return false;
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
      return false;
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

    // PUT the full array back
    await this.client.updateQualityDefinitions(arrDefinitions);
    return true;
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
    try {
      const selections = trashGuideSyncQueries.getSelectionsByInstance(this.instanceId);
      const namingSel = selections.find((s) => s.sectionType === 'naming');
      if (!namingSel) return null;
      return { sourceId: namingSel.sourceId, itemName: namingSel.itemName };
    } catch {
      return null;
    }
  }

  private getTrashQualityDefinitionsSelection(): { sourceId: number; itemName: string } | null {
    try {
      const selections = trashGuideSyncQueries.getSelectionsByInstance(this.instanceId);
      const qdSel = selections.find((s) => s.sectionType === 'qualityDefinitions');
      if (!qdSel) return null;
      return { sourceId: qdSel.sourceId, itemName: qdSel.itemName };
    } catch {
      return null;
    }
  }

  private async syncTrashNaming(): Promise<boolean> {
    const selection = this.getTrashNamingSelection();
    if (!selection) return false;

    const source = trashGuideSourcesQueries.getById(selection.sourceId);
    if (!source) {
      await logger.warn(`TRaSH source ${selection.sourceId} not found for naming sync`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId },
      });
      return false;
    }

    const cachedEntities = trashGuideEntityCacheQueries.getBySourceAndType(selection.sourceId, 'naming');
    const cached = cachedEntities.find((e) => e.name === selection.itemName);
    if (!cached) {
      await logger.warn(`TRaSH naming entity "${selection.itemName}" not found in cache`, {
        source: 'Sync:Naming',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId, itemName: selection.itemName },
      });
      return false;
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
      return true;
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
      return true;
    }

    return false;
  }

  // =========================================================================
  // TRaSH Guide Quality Definitions
  // =========================================================================

  private async syncTrashQualityDefinitions(): Promise<boolean> {
    const selection = this.getTrashQualityDefinitionsSelection();
    if (!selection) return false;

    const source = trashGuideSourcesQueries.getById(selection.sourceId);
    if (!source) {
      await logger.warn(`TRaSH source ${selection.sourceId} not found for quality definitions sync`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId },
      });
      return false;
    }

    const cachedEntities = trashGuideEntityCacheQueries.getBySourceAndType(selection.sourceId, 'quality_size');
    const cached = cachedEntities.find((e) => e.name === selection.itemName);
    if (!cached) {
      await logger.warn(`TRaSH quality_size entity "${selection.itemName}" not found in cache`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, sourceId: selection.sourceId, itemName: selection.itemName },
      });
      return false;
    }

    const entity = JSON.parse(cached.jsonData) as TrashGuideQualitySizeEntity;
    const arrType = source.arr_type as TrashGuideSupportedArrType;
    const result = toPortableQualityDefinitions(entity, arrType);

    if (result.data.entries.length === 0) {
      await logger.debug(`TRaSH quality definitions "${entity.name}" has no entries`, {
        source: 'Sync:QualityDefinitions',
        meta: { instanceId: this.instanceId, entityName: entity.name },
      });
      return false;
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
      return false;
    }

    await logger.debug(`Updating ${updatedCount} quality definitions from TRaSH`, {
      source: 'Sync:QualityDefinitions',
      meta: { instanceId: this.instanceId, entityName: entity.name, updatedCount },
    });

    await this.client.updateQualityDefinitions(arrDefinitions);
    return true;
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
