/**
 * Media management syncer
 * Syncs media management settings from PCD to arr instances
 *
 * Handles three types of configs:
 * 1. Media Settings (downloadPropersAndRepacks, enableMediaInfo)
 * 2. Naming (movie/episode naming formats, folder formats)
 * 3. Quality Definitions (TODO)
 *
 * Flow for each:
 * 1. GET existing config from arr
 * 2. Fetch settings from PCD
 * 3. Modify only the fields we care about
 * 4. PUT the full config back to arr
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { getCache, type PCDCache } from '$pcd/index.ts';
import {
  getRadarrByName as getRadarrMediaSettings,
  getSonarrByName as getSonarrMediaSettings,
} from '$pcd/entities/mediaManagement/media-settings/read.ts';
import {
  getRadarrByName as getRadarrNaming,
  getSonarrByName as getSonarrNaming,
} from '$pcd/entities/mediaManagement/naming/read.ts';
import {
  getRadarrByName as getRadarrQualityDefs,
  getSonarrByName as getSonarrQualityDefs,
  getQualityApiMappings,
  isKnownQualityApiName,
} from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import type {
  QualityDefinitionsConfig,
  RadarrMediaSettingsRow,
  SonarrMediaSettingsRow,
} from '$shared/pcd/display.ts';
import { colonReplacementToDb, multiEpisodeStyleToDb } from '$shared/pcd/mediaManagement.ts';
import type { ArrType, ArrPropersAndRepacks, RadarrNamingConfig, SonarrNamingConfig } from '$arr/types.ts';
import { logger } from '$logger/logger.ts';

const LIDARR_REUSE_ENTITY_REASON =
  'Lidarr v1 reuses Sonarr media-management entities; Lidarr-only fields stay unchanged';
const LIDARR_UNSUPPORTED_FIELD_REASON =
  'Field is not represented by the reused entity strategy and is capability-gated for Lidarr';
const LIDARR_NAMING_SOURCE_FIELD_REASON = 'Sonarr naming fields without a direct Lidarr equivalent are skipped in v1';
const LIDARR_QUALITY_SKIP_REASON =
  'Lidarr quality definition sync applies only entries with Lidarr mappings and matching Lidarr definitions';

const LIDARR_UNSUPPORTED_SONARR_NAMING_FIELDS = [
  'custom_colon_replacement_format',
  'multi_episode_style',
  'standard_episode_format',
  'daily_episode_format',
  'anime_episode_format',
  'series_folder_format',
  'season_folder_format',
] as const;

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

  protected get syncType(): string {
    return 'media management';
  }

  /**
   * Override sync to handle multiple config types
   */
  override async sync(): Promise<SyncResult> {
    const syncConfig = arrSyncQueries.getMediaManagementSync(this.instanceId);
    let totalSynced = 0;
    const errors: string[] = [];

    await logger.info(`Starting media management sync for "${this.instanceName}"`, {
      source: 'Sync:MediaManagement',
      meta: {
        instanceId: this.instanceId,
        hasMediaSettings: !!syncConfig.mediaSettingsDatabaseId && !!syncConfig.mediaSettingsConfigName,
        hasNaming: !!syncConfig.namingDatabaseId && !!syncConfig.namingConfigName,
        hasQualityDefs: !!syncConfig.qualityDefinitionsDatabaseId && !!syncConfig.qualityDefinitionsConfigName,
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

    // Sync naming if configured (both database and config name required)
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
    }

    // Sync quality definitions if configured (both database and config name required)
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
    let mediaSettings: RadarrMediaSettingsRow | SonarrMediaSettingsRow | null = null;
    mediaSettings = await mediaSettingsSource.getByName(cache, configName);

    if (!mediaSettings) {
      await logger.debug(`Media settings config "${configName}" not found in ${mediaSettingsEntity}`, {
        source: 'Sync:MediaSettings',
        meta: {
          instanceId: this.instanceId,
          configName,
          entityType: mediaSettingsEntity,
          reason: this.instanceType === 'lidarr' ? LIDARR_REUSE_ENTITY_REASON : undefined,
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
            reason: LIDARR_REUSE_ENTITY_REASON,
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
    await logger.debug('Using reused Sonarr naming entity for Lidarr sync', {
      source: 'Sync:Naming',
      meta: {
        instanceId: this.instanceId,
        configName,
        entityType: 'sonarr_naming',
        reason: LIDARR_REUSE_ENTITY_REASON,
      },
    });

    const naming = await getSonarrNaming(cache, configName);
    if (!naming) {
      await logger.debug(`Lidarr naming config "${configName}" not found in sonarr_naming`, {
        source: 'Sync:Naming',
        meta: {
          instanceId: this.instanceId,
          configName,
          entityType: 'sonarr_naming',
          reason: LIDARR_REUSE_ENTITY_REASON,
        },
      });
      return false;
    }

    const existingConfig = await this.client.getNamingConfig();
    const lidarrUpdates = {
      renameTracks: naming.rename,
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

    await logger.debug('Skipping unsupported Sonarr naming source fields for Lidarr', {
      source: 'Sync:Naming',
      meta: {
        instanceId: this.instanceId,
        configName,
        skippedFields: [...LIDARR_UNSUPPORTED_SONARR_NAMING_FIELDS],
        reason: LIDARR_NAMING_SOURCE_FIELD_REASON,
      },
    });

    if (appliedFields.length === 0) {
      await logger.warn('No supported Lidarr naming fields available to sync', {
        source: 'Sync:Naming',
        meta: {
          instanceId: this.instanceId,
          configName,
          reason: LIDARR_REUSE_ENTITY_REASON,
        },
      });
      return false;
    }

    const unchangedFields = this.getUnmanagedConfigFields(existingConfig, [
      'renameTracks',
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

    await logger.debug('Updating Lidarr naming from reused Sonarr entity', {
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
    if (this.instanceType === 'lidarr') {
      await logger.debug('Using reused quality definitions entity for Lidarr sync', {
        source: 'Sync:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          entityType: qualityDefinitionsEntity,
          reason: LIDARR_REUSE_ENTITY_REASON,
        },
      });
    }
    const qualityDefsConfig = await getByName(cache, configName);

    if (!qualityDefsConfig) {
      await logger.debug(`Quality definitions config "${configName}" not found in ${qualityDefinitionsEntity}`, {
        source: 'Sync:QualityDefinitions',
        meta: {
          instanceId: this.instanceId,
          configName,
          entityType: qualityDefinitionsEntity,
          reason: this.instanceType === 'lidarr' ? LIDARR_REUSE_ENTITY_REASON : undefined,
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
            meta: { instanceId: this.instanceId, qualityName: entry.quality_name },
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

  private resolveMediaSettingsSource():
    | {
      getByName: (
        cache: PCDCache,
        configName: string,
      ) => Promise<RadarrMediaSettingsRow | SonarrMediaSettingsRow | null>;
      entityType: 'radarr_media_settings' | 'sonarr_media_settings';
    }
    | null {
    if (this.instanceType === 'radarr') {
      return {
        getByName: getRadarrMediaSettings,
        entityType: 'radarr_media_settings',
      };
    }

    if (this.instanceType === 'sonarr' || this.instanceType === 'lidarr') {
      return {
        getByName: getSonarrMediaSettings,
        entityType: 'sonarr_media_settings',
      };
    }

    return null;
  }

  private resolveQualityDefinitionsSource():
    | {
      getByName: (
        cache: PCDCache,
        configName: string,
      ) => Promise<QualityDefinitionsConfig | null>;
      entityType: 'radarr_quality_definitions' | 'sonarr_quality_definitions';
    }
    | null {
    if (this.instanceType === 'radarr') {
      return {
        getByName: getRadarrQualityDefs,
        entityType: 'radarr_quality_definitions',
      };
    }

    if (this.instanceType === 'sonarr' || this.instanceType === 'lidarr') {
      return {
        getByName: getSonarrQualityDefs,
        entityType: 'sonarr_quality_definitions',
      };
    }

    return null;
  }

  private applyConfigUpdates<TConfig extends Record<string, unknown>>(
    existingConfig: TConfig,
    updates: Record<string, unknown>
  ): { updatedConfig: TConfig; appliedFields: string[]; missingFields: string[] } {
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
