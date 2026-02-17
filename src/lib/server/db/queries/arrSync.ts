import { db } from '../db.ts';
import type { ArrType } from '$shared/pcd/types.ts';

// Types
export type SyncTrigger = 'manual' | 'on_pull' | 'on_change' | 'schedule';

export interface ProfileSelection {
  databaseId: number;
  profileName: string;
}

export interface SyncConfig {
  trigger: SyncTrigger;
  cron: string | null;
  nextRunAt?: string | null;
}

export interface QualityProfilesSyncData {
  selections: ProfileSelection[];
  config: SyncConfig;
}

export interface DelayProfilesSyncData {
  databaseId: number | null;
  profileName: string | null;
  trigger: SyncTrigger;
  cron: string | null;
  nextRunAt?: string | null;
}

export interface MediaManagementSyncData {
  namingDatabaseId: number | null;
  namingConfigName: string | null;
  qualityDefinitionsDatabaseId: number | null;
  qualityDefinitionsConfigName: string | null;
  mediaSettingsDatabaseId: number | null;
  mediaSettingsConfigName: string | null;
  trigger: SyncTrigger;
  cron: string | null;
  nextRunAt?: string | null;
}

export interface MetadataProfilesSyncData {
  databaseId: number | null;
  profileName: string | null;
  trigger: SyncTrigger;
  cron: string | null;
  nextRunAt?: string | null;
}

export interface SyncConfigStatus {
  trigger: SyncTrigger;
  cron: string | null;
  nextRunAt: string | null;
  syncStatus: string;
}

// Row types
interface ProfileSelectionRow {
  instance_id: number;
  database_id: number;
  profile_name: string;
}

interface ConfigRow {
  instance_id: number;
  trigger: string;
  cron: string | null;
}

interface ConfigStatusRow {
  trigger: string;
  cron: string | null;
  next_run_at: string | null;
  sync_status: string;
}

interface DelayProfileConfigRow {
  instance_id: number;
  database_id: number | null;
  profile_name: string | null;
  trigger: string;
  cron: string | null;
}

interface MetadataProfileConfigRow {
  instance_id: number;
  database_id: number | null;
  profile_name: string | null;
  trigger: string;
  cron: string | null;
  next_run_at: string | null;
  sync_status: string;
}

interface MediaManagementRow {
  instance_id: number;
  naming_database_id: number | null;
  naming_config_name: string | null;
  quality_definitions_database_id: number | null;
  quality_definitions_config_name: string | null;
  media_settings_database_id: number | null;
  media_settings_config_name: string | null;
  trigger: string;
  cron: string | null;
}

type MediaManagementSection = 'naming' | 'qualityDefinitions' | 'mediaSettings';

interface MediaManagementSectionConfig {
  nameColumn: string;
  databaseColumn: string;
  label: string;
}

type MediaManagementRenameScope = {
  instanceId?: number;
  arrType?: ArrType;
  databaseId?: number;
};

interface NormalizedMediaManagementSelection {
  databaseId: number | null;
  configName: string | null;
}

const MEDIA_MANAGEMENT_SECTION_CONFIG: Record<MediaManagementSection, MediaManagementSectionConfig> = {
  naming: {
    nameColumn: 'naming_config_name',
    databaseColumn: 'naming_database_id',
    label: 'naming',
  },
  qualityDefinitions: {
    nameColumn: 'quality_definitions_config_name',
    databaseColumn: 'quality_definitions_database_id',
    label: 'qualityDefinitions',
  },
  mediaSettings: {
    nameColumn: 'media_settings_config_name',
    databaseColumn: 'media_settings_database_id',
    label: 'mediaSettings',
  },
};

interface ArrSyncMediaManagementMatchRow {
  instance_id: number;
  instance_type: string;
  database_id: number | null;
}

interface ArrSyncMetadataProfileMatchRow {
  instance_id: number;
  instance_type: string;
  database_id: number | null;
}

type MetadataProfileRenameScope = {
  instanceId?: number;
  arrType?: ArrType;
  databaseId?: number;
};

function normalizeSelectionConfigName(configName: string | null | undefined): string | null {
  if (configName === null || configName === undefined) {
    return null;
  }

  if (configName.trim().length === 0) {
    return null;
  }

  // Preserve the exact persisted config name for subsequent exact-match resolution.
  return configName;
}

function normalizeMetadataProfileConfigName(configName: string | null | undefined): string | null {
  if (configName === null || configName === undefined) {
    return null;
  }

  if (configName.trim().length === 0) {
    return null;
  }

  return configName;
}

function normalizeMetadataProfileSelection(
  databaseId: number | null,
  profileName: string | null
): { databaseId: number | null; profileName: string | null } {
  const normalizedProfileName = normalizeMetadataProfileConfigName(profileName);

  if (databaseId === null && normalizedProfileName === null) {
    return { databaseId: null, profileName: null };
  }

  if (databaseId === null || normalizedProfileName === null) {
    throw new Error(
      'Invalid metadata profile selection: database_id and profile_name must be set together'
    );
  }

  return {
    databaseId,
    profileName: normalizedProfileName,
  };
}

function normalizeMediaManagementSelection(
  section: MediaManagementSection,
  databaseId: number | null,
  configName: string | null
): NormalizedMediaManagementSelection {
  const sectionConfig = MEDIA_MANAGEMENT_SECTION_CONFIG[section];
  const normalizedConfigName = normalizeSelectionConfigName(configName);

  if (databaseId === null && normalizedConfigName === null) {
    return { databaseId: null, configName: null };
  }

  if (databaseId === null || normalizedConfigName === null) {
    throw new Error(
      `Invalid media management selection for ${sectionConfig.label}: database_id and config_name must be set together`
    );
  }

  return {
    databaseId,
    configName: normalizedConfigName,
  };
}

function normalizeMediaManagementSyncData(data: MediaManagementSyncData): MediaManagementSyncData {
  const naming = normalizeMediaManagementSelection('naming', data.namingDatabaseId, data.namingConfigName);
  const qualityDefinitions = normalizeMediaManagementSelection(
    'qualityDefinitions',
    data.qualityDefinitionsDatabaseId,
    data.qualityDefinitionsConfigName
  );
  const mediaSettings = normalizeMediaManagementSelection(
    'mediaSettings',
    data.mediaSettingsDatabaseId,
    data.mediaSettingsConfigName
  );

  return {
    namingDatabaseId: naming.databaseId,
    namingConfigName: naming.configName,
    qualityDefinitionsDatabaseId: qualityDefinitions.databaseId,
    qualityDefinitionsConfigName: qualityDefinitions.configName,
    mediaSettingsDatabaseId: mediaSettings.databaseId,
    mediaSettingsConfigName: mediaSettings.configName,
    trigger: data.trigger,
    cron: data.cron,
    nextRunAt: data.nextRunAt ?? null,
  };
}

function validateMetadataProfileSyncScope(instanceId: number): void {
  const row = db.queryFirst<{ type: string }>('SELECT type FROM arr_instances WHERE id = ?', instanceId);
  if (!row) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  if (row.type !== 'lidarr') {
    throw new Error('metadata profile sync is supported only for lidarr instances');
  }
}

function validateRenameNames(oldName: string, newName: string): void {
  if (!oldName.trim()) {
    throw new Error('oldName is required for media management config rename propagation');
  }

  if (!newName.trim()) {
    throw new Error('newName is required for media management config rename propagation');
  }
}

function validateMetadataProfileRenameNames(oldName: string, newName: string): void {
  if (!oldName.trim()) {
    throw new Error('oldName is required for metadata profile config rename propagation');
  }

  if (!newName.trim()) {
    throw new Error('newName is required for metadata profile config rename propagation');
  }
}

function findMetadataProfileSyncRows(
  oldName: string,
  scope: MetadataProfileRenameScope
): ArrSyncMetadataProfileMatchRow[] {
  const conditions: string[] = ['amp.profile_name = ?'];
  const params: Array<number | string> = [oldName];

  if (scope.instanceId !== undefined) {
    conditions.push('amp.instance_id = ?');
    params.push(scope.instanceId);
  }

  if (scope.arrType !== undefined) {
    conditions.push('ai.type = ?');
    params.push(scope.arrType);
  }

  if (scope.databaseId !== undefined) {
    conditions.push('amp.database_id = ?');
    params.push(scope.databaseId);
  }

  const query = `
		SELECT amp.instance_id, ai.type AS instance_type, amp.database_id AS database_id
		FROM arr_sync_metadata_profiles_config amp
		JOIN arr_instances ai ON ai.id = amp.instance_id
		WHERE ${conditions.join(' AND ')}
		ORDER BY amp.instance_id
	`;

  return db.query<ArrSyncMetadataProfileMatchRow>(query, ...params);
}

function updateMetadataProfileConfigName(
  oldName: string,
  newName: string,
  scope: MetadataProfileRenameScope = {}
): number {
  validateMetadataProfileRenameNames(oldName, newName);
  if (oldName === newName) {
    return 0;
  }

  const effectiveScope = { arrType: 'lidarr' as const, ...scope };
  const matches = findMetadataProfileSyncRows(oldName, effectiveScope);

  if (matches.length === 0) {
    return 0;
  }

  const instanceIds = matches.map((row) => row.instance_id);
  const placeholders = instanceIds.map(() => '?').join(', ');
  return db.execute(
    `UPDATE arr_sync_metadata_profiles_config
		   SET profile_name = ?
		   WHERE instance_id IN (${placeholders}) AND profile_name = ?`,
    newName,
    ...instanceIds,
    oldName
  );
}

function findMediaManagementSyncRows(
  section: MediaManagementSection,
  oldName: string,
  scope: MediaManagementRenameScope
): ArrSyncMediaManagementMatchRow[] {
  const sectionConfig = MEDIA_MANAGEMENT_SECTION_CONFIG[section];
  const conditions: string[] = [`asm.${sectionConfig.nameColumn} = ?`];
  const params: Array<number | string> = [oldName];

  if (scope.instanceId !== undefined) {
    conditions.push('asm.instance_id = ?');
    params.push(scope.instanceId);
  }

  if (scope.arrType) {
    conditions.push('ai.type = ?');
    params.push(scope.arrType);
  }

  if (scope.databaseId !== undefined) {
    conditions.push(`asm.${sectionConfig.databaseColumn} = ?`);
    params.push(scope.databaseId);
  }

  const query = `
		SELECT asm.instance_id, ai.type AS instance_type, asm.${sectionConfig.databaseColumn} AS database_id
		FROM arr_sync_media_management asm
		JOIN arr_instances ai ON ai.id = asm.instance_id
		WHERE ${conditions.join(' AND ')}
		ORDER BY asm.instance_id
	`;

  return db.query<ArrSyncMediaManagementMatchRow>(query, ...params);
}

function updateMediaManagementSectionConfigName(
  section: MediaManagementSection,
  oldName: string,
  newName: string,
  scope: MediaManagementRenameScope = {}
): number {
  validateRenameNames(oldName, newName);
  if (oldName === newName) {
    return 0;
  }

  const sectionConfig = MEDIA_MANAGEMENT_SECTION_CONFIG[section];
  const matches = findMediaManagementSyncRows(section, oldName, scope);

  if (matches.length === 0) {
    return 0;
  }

  const instanceIds = matches.map((row) => row.instance_id);
  const placeholders = instanceIds.map(() => '?').join(', ');
  return db.execute(
    `UPDATE arr_sync_media_management
		   SET ${sectionConfig.nameColumn} = ?
		   WHERE instance_id IN (${placeholders}) AND ${sectionConfig.nameColumn} = ?`,
    newName,
    ...instanceIds,
    oldName
  );
}

export const arrSyncQueries = {
  // ========== Quality Profiles ==========

  getQualityProfilesSync(instanceId: number): QualityProfilesSyncData {
    const selectionRows = db.query<ProfileSelectionRow>(
      'SELECT * FROM arr_sync_quality_profiles WHERE instance_id = ?',
      instanceId
    );

    const configRow = db.queryFirst<ConfigRow>(
      'SELECT * FROM arr_sync_quality_profiles_config WHERE instance_id = ?',
      instanceId
    );

    return {
      selections: selectionRows.map((row) => ({
        databaseId: row.database_id,
        profileName: row.profile_name,
      })),
      config: {
        trigger: (configRow?.trigger as SyncTrigger) ?? 'manual',
        cron: configRow?.cron ?? null,
      },
    };
  },

  saveQualityProfilesSync(instanceId: number, selections: ProfileSelection[], config: SyncConfig): void {
    // Clear existing selections
    db.execute('DELETE FROM arr_sync_quality_profiles WHERE instance_id = ?', instanceId);

    // Insert new selections
    for (const sel of selections) {
      db.execute(
        'INSERT INTO arr_sync_quality_profiles (instance_id, database_id, profile_name) VALUES (?, ?, ?)',
        instanceId,
        sel.databaseId,
        sel.profileName
      );
    }

    // Upsert config
    db.execute(
      `INSERT INTO arr_sync_quality_profiles_config (instance_id, trigger, cron, next_run_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(instance_id) DO UPDATE SET trigger = ?, cron = ?, next_run_at = ?`,
      instanceId,
      config.trigger,
      config.cron,
      config.nextRunAt ?? null,
      config.trigger,
      config.cron,
      config.nextRunAt ?? null
    );
  },

  // ========== Delay Profiles ==========

  getDelayProfilesSync(instanceId: number): DelayProfilesSyncData {
    const row = db.queryFirst<DelayProfileConfigRow>(
      'SELECT * FROM arr_sync_delay_profiles_config WHERE instance_id = ?',
      instanceId
    );

    return {
      databaseId: row?.database_id ?? null,
      profileName: row?.profile_name ?? null,
      trigger: (row?.trigger as SyncTrigger) ?? 'manual',
      cron: row?.cron ?? null,
    };
  },

  saveDelayProfilesSync(instanceId: number, data: DelayProfilesSyncData): void {
    db.execute(
      `INSERT INTO arr_sync_delay_profiles_config
			 (instance_id, database_id, profile_name, trigger, cron, next_run_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(instance_id) DO UPDATE SET
			 database_id = ?,
			 profile_name = ?,
			 trigger = ?,
			 cron = ?,
			 next_run_at = ?`,
      instanceId,
      data.databaseId,
      data.profileName,
      data.trigger,
      data.cron,
      data.nextRunAt ?? null,
      data.databaseId,
      data.profileName,
      data.trigger,
      data.cron,
      data.nextRunAt ?? null
    );
  },

  // ========== Metadata Profiles ==========

  getMetadataProfilesSync(instanceId: number): MetadataProfilesSyncData {
    const row = db.queryFirst<MetadataProfileConfigRow>(
      `SELECT mp.instance_id, mp.database_id, mp.profile_name, mp.trigger, mp.cron, mp.next_run_at, mp.sync_status
			 FROM arr_sync_metadata_profiles_config mp
			 JOIN arr_instances ai ON ai.id = mp.instance_id
			 WHERE mp.instance_id = ? AND ai.type = 'lidarr'`,
      instanceId
    );

    return {
      databaseId: row?.database_id ?? null,
      profileName: row?.profile_name ?? null,
      trigger: (row?.trigger as SyncTrigger) ?? 'manual',
      cron: row?.cron ?? null,
    };
  },

  saveMetadataProfilesSync(instanceId: number, data: MetadataProfilesSyncData): void {
    validateMetadataProfileSyncScope(instanceId);
    const normalized = normalizeMetadataProfileSelection(data.databaseId, data.profileName);

    db.execute(
      `INSERT INTO arr_sync_metadata_profiles_config
			 (instance_id, database_id, profile_name, trigger, cron, next_run_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(instance_id) DO UPDATE SET
			 database_id = ?,
			 profile_name = ?,
			 trigger = ?,
			 cron = ?,
			 next_run_at = ?`,
      instanceId,
      normalized.databaseId,
      normalized.profileName,
      data.trigger,
      data.cron,
      data.nextRunAt ?? null,
      normalized.databaseId,
      normalized.profileName,
      data.trigger,
      data.cron,
      data.nextRunAt ?? null
    );
  },

  // ========== Media Management ==========

  getMediaManagementSync(instanceId: number): MediaManagementSyncData {
    const row = db.queryFirst<MediaManagementRow>(
      'SELECT * FROM arr_sync_media_management WHERE instance_id = ?',
      instanceId
    );

    return {
      namingDatabaseId: row?.naming_database_id ?? null,
      namingConfigName: row?.naming_config_name ?? null,
      qualityDefinitionsDatabaseId: row?.quality_definitions_database_id ?? null,
      qualityDefinitionsConfigName: row?.quality_definitions_config_name ?? null,
      mediaSettingsDatabaseId: row?.media_settings_database_id ?? null,
      mediaSettingsConfigName: row?.media_settings_config_name ?? null,
      trigger: (row?.trigger as SyncTrigger) ?? 'manual',
      cron: row?.cron ?? null,
    };
  },

  saveMediaManagementSync(instanceId: number, data: MediaManagementSyncData): void {
    const normalized = normalizeMediaManagementSyncData(data);

    db.execute(
      `INSERT INTO arr_sync_media_management
			 (instance_id, naming_database_id, naming_config_name, quality_definitions_database_id, quality_definitions_config_name, media_settings_database_id, media_settings_config_name, trigger, cron, next_run_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(instance_id) DO UPDATE SET
			 naming_database_id = ?,
			 naming_config_name = ?,
			 quality_definitions_database_id = ?,
			 quality_definitions_config_name = ?,
			 media_settings_database_id = ?,
			 media_settings_config_name = ?,
			 trigger = ?,
			 cron = ?,
			 next_run_at = ?`,
      instanceId,
      normalized.namingDatabaseId,
      normalized.namingConfigName,
      normalized.qualityDefinitionsDatabaseId,
      normalized.qualityDefinitionsConfigName,
      normalized.mediaSettingsDatabaseId,
      normalized.mediaSettingsConfigName,
      normalized.trigger,
      normalized.cron,
      normalized.nextRunAt ?? null,
      normalized.namingDatabaseId,
      normalized.namingConfigName,
      normalized.qualityDefinitionsDatabaseId,
      normalized.qualityDefinitionsConfigName,
      normalized.mediaSettingsDatabaseId,
      normalized.mediaSettingsConfigName,
      normalized.trigger,
      normalized.cron,
      normalized.nextRunAt ?? null
    );
  },

  // ========== Full Sync Data ==========

  getFullSyncData(instanceId: number) {
    return {
      qualityProfiles: this.getQualityProfilesSync(instanceId),
      delayProfiles: this.getDelayProfilesSync(instanceId),
      mediaManagement: this.getMediaManagementSync(instanceId),
      metadataProfiles: this.getMetadataProfilesSync(instanceId),
    };
  },

  // ========== Cleanup ==========

  /**
   * Remove orphaned profile references when a profile is deleted
   */
  removeQualityProfileReference(profileName: string): number {
    return db.execute('DELETE FROM arr_sync_quality_profiles WHERE profile_name = ?', profileName);
  },

  updateQualityProfileName(oldName: string, newName: string): number {
    return db.execute('UPDATE arr_sync_quality_profiles SET profile_name = ? WHERE profile_name = ?', newName, oldName);
  },

  removeDelayProfileReference(profileName: string): number {
    return db.execute(
      'UPDATE arr_sync_delay_profiles_config SET database_id = NULL, profile_name = NULL WHERE profile_name = ?',
      profileName
    );
  },

  updateDelayProfileName(oldName: string, newName: string): number {
    return db.execute(
      'UPDATE arr_sync_delay_profiles_config SET profile_name = ? WHERE profile_name = ?',
      newName,
      oldName
    );
  },

  /**
   * Update config name references when a media management config is renamed
   */
  updateNamingConfigName(oldName: string, newName: string, scope: MediaManagementRenameScope = {}): number {
    return updateMediaManagementSectionConfigName('naming', oldName, newName, scope);
  },

  updateQualityDefinitionsConfigName(oldName: string, newName: string, scope: MediaManagementRenameScope = {}): number {
    return updateMediaManagementSectionConfigName('qualityDefinitions', oldName, newName, scope);
  },

  updateMediaSettingsConfigName(oldName: string, newName: string, scope: MediaManagementRenameScope = {}): number {
    return updateMediaManagementSectionConfigName('mediaSettings', oldName, newName, scope);
  },

  updateMetadataProfileName(oldName: string, newName: string, scope: MetadataProfileRenameScope = {}): number {
    return updateMetadataProfileConfigName(oldName, newName, scope);
  },

  /**
   * Remove all references to a database (when database is deleted)
   */
  removeDatabaseReferences(databaseId: number): void {
    db.execute('DELETE FROM arr_sync_quality_profiles WHERE database_id = ?', databaseId);
    db.execute(
      'UPDATE arr_sync_delay_profiles_config SET database_id = NULL, profile_name = NULL WHERE database_id = ?',
      databaseId
    );
    db.execute(
      'UPDATE arr_sync_media_management SET naming_database_id = NULL, naming_config_name = NULL WHERE naming_database_id = ?',
      databaseId
    );
    db.execute(
      'UPDATE arr_sync_media_management SET quality_definitions_database_id = NULL, quality_definitions_config_name = NULL WHERE quality_definitions_database_id = ?',
      databaseId
    );
    db.execute(
      'UPDATE arr_sync_media_management SET media_settings_database_id = NULL, media_settings_config_name = NULL WHERE media_settings_database_id = ?',
      databaseId
    );
    db.execute(
      'UPDATE arr_sync_metadata_profiles_config SET database_id = NULL, profile_name = NULL WHERE database_id = ?',
      databaseId
    );
  },

  removeMetadataProfileReference(profileName: string): number {
    return db.execute(
      `UPDATE arr_sync_metadata_profiles_config
			 SET database_id = NULL, profile_name = NULL
			 WHERE profile_name = ?
			 AND instance_id IN (SELECT id FROM arr_instances WHERE type = 'lidarr')`,
      profileName
    );
  },

  // ========== Should Sync Flags ==========

  /**
   * Set should_sync flag for quality profiles
   */
  setQualityProfilesShouldSync(instanceId: number, shouldSync: boolean): void {
    db.execute(
      'UPDATE arr_sync_quality_profiles_config SET should_sync = ? WHERE instance_id = ?',
      shouldSync ? 1 : 0,
      instanceId
    );
  },

  /**
   * Set should_sync flag for delay profiles
   */
  setDelayProfilesShouldSync(instanceId: number, shouldSync: boolean): void {
    db.execute(
      'UPDATE arr_sync_delay_profiles_config SET should_sync = ? WHERE instance_id = ?',
      shouldSync ? 1 : 0,
      instanceId
    );
  },

  /**
   * Set should_sync flag for media management
   */
  setMediaManagementShouldSync(instanceId: number, shouldSync: boolean): void {
    db.execute(
      'UPDATE arr_sync_media_management SET should_sync = ? WHERE instance_id = ?',
      shouldSync ? 1 : 0,
      instanceId
    );
  },

  setMetadataProfilesShouldSync(instanceId: number, shouldSync: boolean): void {
    db.execute(
      `UPDATE arr_sync_metadata_profiles_config
			 SET should_sync = ?
			 WHERE instance_id = ?
			 AND instance_id IN (SELECT id FROM arr_instances WHERE type = 'lidarr')`,
      shouldSync ? 1 : 0,
      instanceId
    );
  },

  /**
   * Mark all configs with a specific trigger as should_sync
   * Used when events occur (pull, change)
   * Also sets sync_status to 'pending' for the new status-based flow
   */
  markForSync(trigger: 'on_pull' | 'on_change'): void {
    const triggers = trigger === 'on_change' ? ['on_pull', 'on_change'] : ['on_pull'];
    const placeholders = triggers.map(() => '?').join(', ');

    db.execute(
      `UPDATE arr_sync_quality_profiles_config SET should_sync = 1, sync_status = 'pending' WHERE trigger IN (${placeholders})`,
      ...triggers
    );
    db.execute(
      `UPDATE arr_sync_delay_profiles_config SET should_sync = 1, sync_status = 'pending' WHERE trigger IN (${placeholders})`,
      ...triggers
    );
    db.execute(
      `UPDATE arr_sync_media_management SET should_sync = 1, sync_status = 'pending' WHERE trigger IN (${placeholders})`,
      ...triggers
    );
    db.execute(
      `UPDATE arr_sync_metadata_profiles_config
			 SET should_sync = 1, sync_status = 'pending'
			 WHERE trigger IN (${placeholders})
			 AND instance_id IN (SELECT id FROM arr_instances WHERE type = 'lidarr')`,
      ...triggers
    );
  },

  /**
   * Get all configs that need syncing (should_sync = true)
   */
  getPendingSyncs(): {
    qualityProfiles: number[];
    delayProfiles: number[];
    mediaManagement: number[];
    metadataProfiles: number[];
  } {
    const qp = db.query<{ instance_id: number }>(
      'SELECT instance_id FROM arr_sync_quality_profiles_config WHERE should_sync = 1'
    );
    const dp = db.query<{ instance_id: number }>(
      'SELECT instance_id FROM arr_sync_delay_profiles_config WHERE should_sync = 1'
    );
    const mm = db.query<{ instance_id: number }>(
      'SELECT instance_id FROM arr_sync_media_management WHERE should_sync = 1'
    );
    const mp = db.query<{ instance_id: number }>(
      `SELECT mp.instance_id
			 FROM arr_sync_metadata_profiles_config mp
			 JOIN arr_instances ai ON ai.id = mp.instance_id
			 WHERE mp.should_sync = 1 AND ai.type = 'lidarr'`
    );

    return {
      qualityProfiles: qp.map((r) => r.instance_id),
      delayProfiles: dp.map((r) => r.instance_id),
      mediaManagement: mm.map((r) => r.instance_id),
      metadataProfiles: mp.map((r) => r.instance_id),
    };
  },

  /**
   * Get all scheduled configs that haven't been marked for sync yet
   */
  getScheduledConfigs(): {
    qualityProfiles: { instanceId: number; cron: string | null; nextRunAt: string | null }[];
    delayProfiles: { instanceId: number; cron: string | null; nextRunAt: string | null }[];
    mediaManagement: { instanceId: number; cron: string | null; nextRunAt: string | null }[];
    metadataProfiles: { instanceId: number; cron: string | null; nextRunAt: string | null }[];
  } {
    const qp = db.query<{ instance_id: number; cron: string | null; next_run_at: string | null }>(
      "SELECT instance_id, cron, next_run_at FROM arr_sync_quality_profiles_config WHERE trigger = 'schedule' AND should_sync = 0"
    );
    const dp = db.query<{ instance_id: number; cron: string | null; next_run_at: string | null }>(
      "SELECT instance_id, cron, next_run_at FROM arr_sync_delay_profiles_config WHERE trigger = 'schedule' AND should_sync = 0"
    );
    const mm = db.query<{ instance_id: number; cron: string | null; next_run_at: string | null }>(
      "SELECT instance_id, cron, next_run_at FROM arr_sync_media_management WHERE trigger = 'schedule' AND should_sync = 0"
    );
    const mp = db.query<{ instance_id: number; cron: string | null; next_run_at: string | null }>(
      `SELECT mp.instance_id, mp.cron, mp.next_run_at
			 FROM arr_sync_metadata_profiles_config mp
			 JOIN arr_instances ai ON ai.id = mp.instance_id
			 WHERE mp.trigger = 'schedule' AND mp.should_sync = 0 AND ai.type = 'lidarr'`
    );

    return {
      qualityProfiles: qp.map((r) => ({
        instanceId: r.instance_id,
        cron: r.cron,
        nextRunAt: r.next_run_at,
      })),
      delayProfiles: dp.map((r) => ({
        instanceId: r.instance_id,
        cron: r.cron,
        nextRunAt: r.next_run_at,
      })),
      mediaManagement: mm.map((r) => ({
        instanceId: r.instance_id,
        cron: r.cron,
        nextRunAt: r.next_run_at,
      })),
      metadataProfiles: mp.map((r) => ({
        instanceId: r.instance_id,
        cron: r.cron,
        nextRunAt: r.next_run_at,
      })),
    };
  },

  /**
   * Update next_run_at for a quality profiles config
   */
  setQualityProfilesNextRunAt(instanceId: number, nextRunAt: string | null): void {
    db.execute(
      'UPDATE arr_sync_quality_profiles_config SET next_run_at = ? WHERE instance_id = ?',
      nextRunAt,
      instanceId
    );
  },

  /**
   * Update next_run_at for a delay profiles config
   */
  setDelayProfilesNextRunAt(instanceId: number, nextRunAt: string | null): void {
    db.execute(
      'UPDATE arr_sync_delay_profiles_config SET next_run_at = ? WHERE instance_id = ?',
      nextRunAt,
      instanceId
    );
  },

  /**
   * Update next_run_at for a media management config
   */
  setMediaManagementNextRunAt(instanceId: number, nextRunAt: string | null): void {
    db.execute('UPDATE arr_sync_media_management SET next_run_at = ? WHERE instance_id = ?', nextRunAt, instanceId);
  },

  setMetadataProfilesNextRunAt(instanceId: number, nextRunAt: string | null): void {
    db.execute(
      `UPDATE arr_sync_metadata_profiles_config
			 SET next_run_at = ?
			 WHERE instance_id = ?`,
      nextRunAt,
      instanceId
    );
  },

  // ========== Sync Status Methods (Migration 034) ==========

  /**
   * Atomically claim a sync for processing
   * Returns true if claim succeeded (status was 'pending' and is now 'in_progress')
   */
  claimQualityProfilesSync(instanceId: number): boolean {
    const result = db.execute(
      "UPDATE arr_sync_quality_profiles_config SET sync_status = 'in_progress' WHERE instance_id = ? AND sync_status = 'pending'",
      instanceId
    );
    return result > 0;
  },

  claimDelayProfilesSync(instanceId: number): boolean {
    const result = db.execute(
      "UPDATE arr_sync_delay_profiles_config SET sync_status = 'in_progress' WHERE instance_id = ? AND sync_status = 'pending'",
      instanceId
    );
    return result > 0;
  },

  claimMediaManagementSync(instanceId: number): boolean {
    const result = db.execute(
      "UPDATE arr_sync_media_management SET sync_status = 'in_progress' WHERE instance_id = ? AND sync_status = 'pending'",
      instanceId
    );
    return result > 0;
  },

  claimMetadataProfilesSync(instanceId: number): boolean {
    const result = db.execute(
      "UPDATE arr_sync_metadata_profiles_config SET sync_status = 'in_progress' WHERE instance_id = ? AND sync_status = 'pending' AND instance_id IN (SELECT id FROM arr_instances WHERE type = 'lidarr')",
      instanceId
    );
    return result > 0;
  },

  /**
   * Mark sync as completed successfully
   */
  completeQualityProfilesSync(instanceId: number): void {
    db.execute(
      "UPDATE arr_sync_quality_profiles_config SET sync_status = 'idle', should_sync = 0, last_error = NULL, last_synced_at = ? WHERE instance_id = ?",
      new Date().toISOString(),
      instanceId
    );
  },

  completeDelayProfilesSync(instanceId: number): void {
    db.execute(
      "UPDATE arr_sync_delay_profiles_config SET sync_status = 'idle', should_sync = 0, last_error = NULL, last_synced_at = ? WHERE instance_id = ?",
      new Date().toISOString(),
      instanceId
    );
  },

  completeMediaManagementSync(instanceId: number): void {
    db.execute(
      "UPDATE arr_sync_media_management SET sync_status = 'idle', should_sync = 0, last_error = NULL, last_synced_at = ? WHERE instance_id = ?",
      new Date().toISOString(),
      instanceId
    );
  },

  completeMetadataProfilesSync(instanceId: number): void {
    db.execute(
      `UPDATE arr_sync_metadata_profiles_config
			 SET sync_status = 'idle', should_sync = 0, last_error = NULL, last_synced_at = ?
			 WHERE instance_id = ?`,
      new Date().toISOString(),
      instanceId
    );
  },

  /**
   * Mark sync as failed
   */
  failQualityProfilesSync(instanceId: number, error: string): void {
    db.execute(
      "UPDATE arr_sync_quality_profiles_config SET sync_status = 'failed', should_sync = 0, last_error = ? WHERE instance_id = ?",
      error,
      instanceId
    );
  },

  failDelayProfilesSync(instanceId: number, error: string): void {
    db.execute(
      "UPDATE arr_sync_delay_profiles_config SET sync_status = 'failed', should_sync = 0, last_error = ? WHERE instance_id = ?",
      error,
      instanceId
    );
  },

  failMediaManagementSync(instanceId: number, error: string): void {
    db.execute(
      "UPDATE arr_sync_media_management SET sync_status = 'failed', should_sync = 0, last_error = ? WHERE instance_id = ?",
      error,
      instanceId
    );
  },

  failMetadataProfilesSync(instanceId: number, error: string): void {
    db.execute(
      "UPDATE arr_sync_metadata_profiles_config SET sync_status = 'failed', should_sync = 0, last_error = ? WHERE instance_id = ?",
      error,
      instanceId
    );
  },

  /**
   * Set sync status to pending (used by markForSync and triggers)
   */
  setQualityProfilesStatusPending(instanceId: number): void {
    db.execute(
      "UPDATE arr_sync_quality_profiles_config SET sync_status = 'pending', should_sync = 1 WHERE instance_id = ?",
      instanceId
    );
  },

  setDelayProfilesStatusPending(instanceId: number): void {
    db.execute(
      "UPDATE arr_sync_delay_profiles_config SET sync_status = 'pending', should_sync = 1 WHERE instance_id = ?",
      instanceId
    );
  },

  setMediaManagementStatusPending(instanceId: number): void {
    db.execute(
      "UPDATE arr_sync_media_management SET sync_status = 'pending', should_sync = 1 WHERE instance_id = ?",
      instanceId
    );
  },

  setMetadataProfilesStatusPending(instanceId: number): void {
    db.execute(
      "UPDATE arr_sync_metadata_profiles_config SET sync_status = 'pending', should_sync = 1 WHERE instance_id = ?",
      instanceId
    );
  },

  /**
   * Get pending syncs by status (uses new sync_status column)
   */
  getPendingSyncsByStatus(): {
    qualityProfiles: number[];
    delayProfiles: number[];
    mediaManagement: number[];
    metadataProfiles: number[];
  } {
    const qp = db.query<{ instance_id: number }>(
      "SELECT instance_id FROM arr_sync_quality_profiles_config WHERE sync_status = 'pending'"
    );
    const dp = db.query<{ instance_id: number }>(
      "SELECT instance_id FROM arr_sync_delay_profiles_config WHERE sync_status = 'pending'"
    );
    const mm = db.query<{ instance_id: number }>(
      "SELECT instance_id FROM arr_sync_media_management WHERE sync_status = 'pending'"
    );
    const mp = db.query<{ instance_id: number }>(
      `SELECT mp.instance_id
			 FROM arr_sync_metadata_profiles_config mp
			 JOIN arr_instances ai ON ai.id = mp.instance_id
			 WHERE mp.sync_status = 'pending' AND ai.type = 'lidarr'`
    );

    return {
      qualityProfiles: qp.map((r) => r.instance_id),
      delayProfiles: dp.map((r) => r.instance_id),
      mediaManagement: mm.map((r) => r.instance_id),
      metadataProfiles: mp.map((r) => r.instance_id),
    };
  },

  /**
   * Reset any in_progress syncs back to pending (for startup recovery)
   */
  recoverInterruptedSyncs(): number {
    let count = 0;
    count += db.execute(
      "UPDATE arr_sync_quality_profiles_config SET sync_status = 'pending' WHERE sync_status = 'in_progress'"
    );
    count += db.execute(
      "UPDATE arr_sync_delay_profiles_config SET sync_status = 'pending' WHERE sync_status = 'in_progress'"
    );
    count += db.execute(
      "UPDATE arr_sync_media_management SET sync_status = 'pending' WHERE sync_status = 'in_progress'"
    );
    count += db.execute(
      `UPDATE arr_sync_metadata_profiles_config mp
			 SET sync_status = 'pending'
			 WHERE mp.sync_status = 'in_progress'
			 AND mp.instance_id IN (SELECT id FROM arr_instances WHERE type = 'lidarr')`
    );
    return count;
  },

  /**
   * Check if any sync configs have a scheduled (cron) trigger
   * Used to determine if any arr.sync scheduled jobs should be enabled
   */
  hasAnyScheduledConfigs(): boolean {
    const result = db.queryFirst<{ count: number }>(`
			SELECT COUNT(*) as count FROM (
			SELECT 1 FROM arr_sync_quality_profiles_config WHERE trigger = 'schedule'
			UNION ALL
			SELECT 1 FROM arr_sync_delay_profiles_config WHERE trigger = 'schedule'
			UNION ALL
			SELECT 1 FROM arr_sync_media_management WHERE trigger = 'schedule'
			UNION ALL
			SELECT 1
			FROM arr_sync_metadata_profiles_config mp
			JOIN arr_instances ai ON ai.id = mp.instance_id
			WHERE mp.trigger = 'schedule' AND ai.type = 'lidarr'
		)
	`);
    return (result?.count ?? 0) > 0;
  },

  getSyncConfigStatus(instanceId: number): {
    qualityProfiles: SyncConfigStatus;
    delayProfiles: SyncConfigStatus;
    mediaManagement: SyncConfigStatus;
    metadataProfiles: SyncConfigStatus;
  } {
    const qp = db.queryFirst<ConfigStatusRow>(
      'SELECT trigger, cron, next_run_at, sync_status FROM arr_sync_quality_profiles_config WHERE instance_id = ?',
      instanceId
    );
    const dp = db.queryFirst<ConfigStatusRow>(
      'SELECT trigger, cron, next_run_at, sync_status FROM arr_sync_delay_profiles_config WHERE instance_id = ?',
      instanceId
    );
    const mm = db.queryFirst<ConfigStatusRow>(
      'SELECT trigger, cron, next_run_at, sync_status FROM arr_sync_media_management WHERE instance_id = ?',
      instanceId
    );
    const mp = db.queryFirst<ConfigStatusRow>(
      `SELECT amp.trigger, amp.cron, amp.next_run_at, amp.sync_status
			 FROM arr_sync_metadata_profiles_config amp
			 JOIN arr_instances ai ON ai.id = amp.instance_id
			 WHERE amp.instance_id = ? AND ai.type = 'lidarr'`,
      instanceId
    );

    return {
      qualityProfiles: {
        trigger: (qp?.trigger as SyncTrigger) ?? 'manual',
        cron: qp?.cron ?? null,
        nextRunAt: qp?.next_run_at ?? null,
        syncStatus: qp?.sync_status ?? 'idle',
      },
      delayProfiles: {
        trigger: (dp?.trigger as SyncTrigger) ?? 'manual',
        cron: dp?.cron ?? null,
        nextRunAt: dp?.next_run_at ?? null,
        syncStatus: dp?.sync_status ?? 'idle',
      },
      mediaManagement: {
        trigger: (mm?.trigger as SyncTrigger) ?? 'manual',
        cron: mm?.cron ?? null,
        nextRunAt: mm?.next_run_at ?? null,
        syncStatus: mm?.sync_status ?? 'idle',
      },
      metadataProfiles: {
        trigger: (mp?.trigger as SyncTrigger) ?? 'manual',
        cron: mp?.cron ?? null,
        nextRunAt: mp?.next_run_at ?? null,
        syncStatus: mp?.sync_status ?? 'idle',
      },
    };
  },

  getNextScheduledRunAt(instanceId: number): string | null {
    const rows = db.query<{ next_run_at: string | null }>(
      `SELECT next_run_at FROM arr_sync_quality_profiles_config WHERE instance_id = ? AND trigger = 'schedule'
			 UNION ALL
			 SELECT next_run_at FROM arr_sync_delay_profiles_config WHERE instance_id = ? AND trigger = 'schedule'
			 UNION ALL
			 SELECT next_run_at FROM arr_sync_media_management WHERE instance_id = ? AND trigger = 'schedule'
			 UNION ALL
			 SELECT amp.next_run_at
			 FROM arr_sync_metadata_profiles_config amp
			 JOIN arr_instances ai ON ai.id = amp.instance_id
			 WHERE amp.instance_id = ? AND amp.trigger = 'schedule' AND ai.type = 'lidarr'`,
      instanceId,
      instanceId,
      instanceId,
      instanceId
    );

    const candidates = rows.map((row) => row.next_run_at).filter((value): value is string => !!value);

    if (candidates.length === 0) return null;

    return candidates.reduce((earliest, current) => (new Date(current) < new Date(earliest) ? current : earliest));
  },

  getInstanceIdsForTrigger(trigger: SyncTrigger): number[] {
    const triggers = trigger === 'on_change' ? ['on_pull', 'on_change'] : [trigger];
    const placeholders = triggers.map(() => '?').join(', ');

    const rows = db.query<{ instance_id: number }>(
      `SELECT instance_id FROM arr_sync_quality_profiles_config WHERE trigger IN (${placeholders})
			 UNION
			 SELECT instance_id FROM arr_sync_delay_profiles_config WHERE trigger IN (${placeholders})
			 UNION
			 SELECT instance_id FROM arr_sync_media_management WHERE trigger IN (${placeholders})
			 UNION
			 SELECT amp.instance_id
			 FROM arr_sync_metadata_profiles_config amp
			 JOIN arr_instances ai ON ai.id = amp.instance_id
			 WHERE amp.trigger IN (${placeholders}) AND ai.type = 'lidarr'`,
      ...triggers,
      ...triggers,
      ...triggers,
      ...triggers
    );

    return rows.map((row) => row.instance_id);
  },
};
