/**
 * Metadata profile syncer
 *
 * Syncs a single metadata profile from PCD to a Lidarr instance.
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import type { SyncEntityOutcome } from '../types.ts';
import { sanitizeArrWriteError } from '../sanitizeArrWriteError.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { getCache } from '$pcd/index.ts';
import type {
  LidarrMetadataProfile as PcdMetadataProfile,
  MetadataProfileAlbumTypeToggle,
  MetadataProfileReleaseStatusToggle,
} from '$pcd/entities/metadataProfiles/read.ts';
import type {
  LidarrMetadataProfileCreatePayload,
  LidarrMetadataProfile,
  LidarrMetadataProfileSchema,
  LidarrProfilePrimaryAlbumTypeItem,
  LidarrProfileReleaseStatusItem,
  LidarrProfileSecondaryAlbumTypeItem,
} from '$arr/types.ts';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { getNamespaceSuffix } from '../namespace.ts';
import { logger } from '$logger/logger.ts';
import { HttpError } from '$http/types.ts';
import { diffSingletonEntity, METADATA_PROFILE_ARRAY_KEY_STRATEGIES } from '../preview/sectionDiffs.ts';
import type { MetadataProfilesPreview, SyncPreviewSectionResult } from '../preview/types.ts';

interface MetadataProfilesPreviewConfig {
  databaseId: number | null;
  profileName: string | null;
}

function parseMetadataProfilesPreviewConfig(rawConfig: unknown): MetadataProfilesPreviewConfig | null {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return null;
  }

  const value = rawConfig as Record<string, unknown>;
  if (!('databaseId' in value) || !('profileName' in value)) {
    return null;
  }

  const rawDatabaseId = value.databaseId;
  const rawProfileName = value.profileName;
  const databaseId = rawDatabaseId === null || rawDatabaseId === undefined ? null : parsePositiveInt(rawDatabaseId);
  const profileName = typeof rawProfileName === 'string' && rawProfileName.length > 0 ? rawProfileName : null;

  if (databaseId === null && profileName === null) {
    return {
      databaseId: null,
      profileName: null,
    };
  }

  if (databaseId === null || profileName === null) {
    return null;
  }

  return {
    databaseId,
    profileName,
  };
}

function parsePositiveInt(rawValue: unknown): number | null {
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue <= 0) {
    return null;
  }

  return rawValue;
}

const METADATA_PROFILE_SCHEMA_FALLBACK: Omit<LidarrMetadataProfileSchema, 'id' | 'name'> = {
  primaryAlbumTypes: [
    { albumType: { id: 0, name: 'Album' }, allowed: false },
    { albumType: { id: 1, name: 'EP' }, allowed: false },
    { albumType: { id: 2, name: 'Single' }, allowed: false },
    { albumType: { id: 3, name: 'Broadcast' }, allowed: false },
    { albumType: { id: 4, name: 'Other' }, allowed: false },
  ],
  secondaryAlbumTypes: [
    { albumType: { id: 0, name: 'Studio' }, allowed: false },
    { albumType: { id: 1, name: 'Compilation' }, allowed: false },
    { albumType: { id: 2, name: 'Soundtrack' }, allowed: false },
    { albumType: { id: 3, name: 'Spokenword' }, allowed: false },
    { albumType: { id: 4, name: 'Interview' }, allowed: false },
    { albumType: { id: 6, name: 'Live' }, allowed: false },
    { albumType: { id: 7, name: 'Remix' }, allowed: false },
    { albumType: { id: 8, name: 'DJ-mix' }, allowed: false },
    { albumType: { id: 9, name: 'Mixtape/Street' }, allowed: false },
    { albumType: { id: 10, name: 'Demo' }, allowed: false },
    { albumType: { id: 11, name: 'Audio drama' }, allowed: false },
  ],
  releaseStatuses: [
    { releaseStatus: { id: 0, name: 'Official' }, allowed: false },
    { releaseStatus: { id: 1, name: 'Promotion' }, allowed: false },
    { releaseStatus: { id: 2, name: 'Bootleg' }, allowed: false },
    { releaseStatus: { id: 3, name: 'Pseudo-Release' }, allowed: false },
  ],
};

function toPrimaryAlbumTypeItem(toggle: MetadataProfileAlbumTypeToggle): LidarrProfilePrimaryAlbumTypeItem {
  return {
    albumType: {
      id: toggle.typeId,
      name: toggle.name,
    },
    allowed: toggle.allowed,
  };
}

function toSecondaryAlbumTypeItem(toggle: MetadataProfileAlbumTypeToggle): LidarrProfileSecondaryAlbumTypeItem {
  return {
    albumType: {
      id: toggle.typeId,
      name: toggle.name,
    },
    allowed: toggle.allowed,
  };
}

function toReleaseStatusItem(toggle: MetadataProfileReleaseStatusToggle): LidarrProfileReleaseStatusItem {
  return {
    releaseStatus: {
      id: toggle.statusId,
      name: toggle.name,
    },
    allowed: toggle.allowed,
  };
}

function normalizePrimaryAlbumTypes(
  profile: PcdMetadataProfile,
  schema: LidarrMetadataProfileSchema
): LidarrProfilePrimaryAlbumTypeItem[] {
  const allowedByTypeId = new Map<number, boolean>(
    profile.primaryAlbumTypes.map((entry) => [entry.typeId, entry.allowed])
  );

  return schema.primaryAlbumTypes.map((item) => ({
    albumType: {
      id: item.albumType.id,
      name: item.albumType.name,
    },
    allowed: allowedByTypeId.get(item.albumType.id) ?? false,
  }));
}

function normalizeSecondaryAlbumTypes(
  profile: PcdMetadataProfile,
  schema: LidarrMetadataProfileSchema
): LidarrProfileSecondaryAlbumTypeItem[] {
  const allowedByTypeId = new Map<number, boolean>(
    profile.secondaryAlbumTypes.map((entry) => [entry.typeId, entry.allowed])
  );

  return schema.secondaryAlbumTypes.map((item) => ({
    albumType: {
      id: item.albumType.id,
      name: item.albumType.name,
    },
    allowed: allowedByTypeId.get(item.albumType.id) ?? false,
  }));
}

function normalizeReleaseStatuses(
  profile: PcdMetadataProfile,
  schema: LidarrMetadataProfileSchema
): LidarrProfileReleaseStatusItem[] {
  const allowedByStatusId = new Map<number, boolean>(
    profile.releaseStatuses.map((entry) => [entry.statusId, entry.allowed])
  );

  return schema.releaseStatuses.map((item) => ({
    releaseStatus: {
      id: item.releaseStatus.id,
      name: item.releaseStatus.name,
    },
    allowed: allowedByStatusId.get(item.releaseStatus.id) ?? false,
  }));
}

function transform(profile: PcdMetadataProfile): LidarrMetadataProfileCreatePayload {
  return {
    name: profile.name,
    primaryAlbumTypes: profile.primaryAlbumTypes.map(toPrimaryAlbumTypeItem),
    secondaryAlbumTypes: profile.secondaryAlbumTypes.map(toSecondaryAlbumTypeItem),
    releaseStatuses: profile.releaseStatuses.map(toReleaseStatusItem),
  };
}

function buildPayload(
  profile: PcdMetadataProfile,
  schema?: LidarrMetadataProfileSchema | null
): LidarrMetadataProfileCreatePayload {
  if (!schema) {
    return transform(profile);
  }

  return {
    name: profile.name,
    primaryAlbumTypes: normalizePrimaryAlbumTypes(profile, schema),
    secondaryAlbumTypes: normalizeSecondaryAlbumTypes(profile, schema),
    releaseStatuses: normalizeReleaseStatuses(profile, schema),
  };
}

function normalizeSchema(schema: LidarrMetadataProfileSchema | null | undefined): LidarrMetadataProfileSchema {
  if (!schema) {
    return {
      id: 0,
      name: '',
      ...METADATA_PROFILE_SCHEMA_FALLBACK,
    };
  }

  return {
    id: schema.id ?? 0,
    name: schema.name,
    primaryAlbumTypes:
      Array.isArray(schema.primaryAlbumTypes) && schema.primaryAlbumTypes.length > 0
        ? schema.primaryAlbumTypes
        : METADATA_PROFILE_SCHEMA_FALLBACK.primaryAlbumTypes,
    secondaryAlbumTypes:
      Array.isArray(schema.secondaryAlbumTypes) && schema.secondaryAlbumTypes.length > 0
        ? schema.secondaryAlbumTypes
        : METADATA_PROFILE_SCHEMA_FALLBACK.secondaryAlbumTypes,
    releaseStatuses:
      Array.isArray(schema.releaseStatuses) && schema.releaseStatuses.length > 0
        ? schema.releaseStatuses
        : METADATA_PROFILE_SCHEMA_FALLBACK.releaseStatuses,
  };
}

function readErrorDetails(error: unknown): { message: string; response?: unknown } {
  if (error instanceof Error) {
    if (error instanceof HttpError) {
      return {
        message: error.message,
        response: error.response,
      };
    }
    return { message: error.message };
  }

  return { message: 'Unknown error' };
}

function findMatchingRemoteProfile(
  profileName: string,
  remoteProfiles: ReadonlyArray<LidarrMetadataProfile>
): LidarrMetadataProfile | undefined {
  return remoteProfiles.find((profile) => profile.name === profileName);
}

async function getMetadataProfileFromCache(databaseId: number, name: string): Promise<PcdMetadataProfile | null> {
  const cache = getCache(databaseId);
  if (!cache) return null;

  const profile = await cache.kb
    .selectFrom('lidarr_metadata_profiles')
    .select(['id', 'name', 'description'])
    .where('name', '=', name)
    .executeTakeFirst();

  if (!profile) return null;

  const [primaryRows, secondaryRows, statusRows] = await Promise.all([
    cache.kb
      .selectFrom('lidarr_metadata_profile_primary_types')
      .select(['type_id', 'name', 'allowed'])
      .where('metadata_profile_name', '=', profile.name)
      .orderBy('type_id')
      .execute(),
    cache.kb
      .selectFrom('lidarr_metadata_profile_secondary_types')
      .select(['type_id', 'name', 'allowed'])
      .where('metadata_profile_name', '=', profile.name)
      .orderBy('type_id')
      .execute(),
    cache.kb
      .selectFrom('lidarr_metadata_profile_release_statuses')
      .select(['status_id', 'name', 'allowed'])
      .where('metadata_profile_name', '=', profile.name)
      .orderBy('status_id')
      .execute(),
  ]);

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    primaryAlbumTypes: primaryRows.map((row) => ({
      typeId: row.type_id,
      name: row.name,
      allowed: row.allowed === 1,
    })),
    secondaryAlbumTypes: secondaryRows.map((row) => ({
      typeId: row.type_id,
      name: row.name,
      allowed: row.allowed === 1,
    })),
    releaseStatuses: statusRows.map((row) => ({
      statusId: row.status_id,
      name: row.name,
      allowed: row.allowed === 1,
    })),
  };
}

export class MetadataProfileSyncer extends BaseSyncer {
  protected get syncType(): string {
    return 'metadata profile';
  }

  override async generatePreview(): Promise<Readonly<SyncPreviewSectionResult>> {
    const lidarrClient = this.getLidarrClient();
    const syncConfig = this.getMetadataProfilesSyncConfig();

    if (!syncConfig.databaseId || !syncConfig.profileName) {
      await logger.debug('No metadata profile configured for preview', {
        source: 'Preview:MetadataProfile',
        meta: { instanceId: this.instanceId },
      });
      const result: MetadataProfilesPreview = {
        section: 'metadataProfiles',
        profile: null,
      };

      return result;
    }

    const profile = await getMetadataProfileFromCache(syncConfig.databaseId, syncConfig.profileName);
    if (!profile) {
      throw new Error(`Metadata profile "${syncConfig.profileName}" not found in PCD cache`);
    }

    const namespaceIndex = arrNamespaceQueries.getOrCreate(this.instanceId, syncConfig.databaseId);
    const namespaceSuffix = getNamespaceSuffix(namespaceIndex);
    const suffixedProfileName = `${profile.name}${namespaceSuffix}`;

    let metadataSchema: LidarrMetadataProfileSchema | null = null;
    try {
      metadataSchema = await lidarrClient.getMetadataProfileSchemaOrNull();
      if (!metadataSchema) {
        await logger.warn('Failed to load Lidarr metadata profile schema for preview; using local values', {
          source: 'Preview:MetadataProfile',
          meta: { instanceId: this.instanceId },
        });
      }
    } catch (error) {
      const { message, response } = readErrorDetails(error);
      await logger.warn('Failed to load Lidarr metadata profile schema for preview; using local values', {
        source: 'Preview:MetadataProfile',
        meta: {
          instanceId: this.instanceId,
          error: message,
          response,
        },
      });
    }

    const normalizedSchema = normalizeSchema(metadataSchema);

    const normalizedPayload = buildPayload(
      {
        ...profile,
        name: suffixedProfileName,
      },
      normalizedSchema
    );

    const remoteProfiles = await lidarrClient.getMetadataProfiles();
    const existingProfile = findMatchingRemoteProfile(suffixedProfileName, remoteProfiles);

    const profileChange = diffSingletonEntity({
      entityType: 'metadataProfile',
      name: suffixedProfileName,
      desiredEntity: normalizedPayload as unknown as Record<string, unknown>,
      currentEntity: (existingProfile ?? null) as Record<string, unknown> | null,
      currentComparable: (entity) => ({
        name: (entity as unknown as LidarrMetadataProfile).name,
        primaryAlbumTypes: (entity as unknown as LidarrMetadataProfile).primaryAlbumTypes,
        secondaryAlbumTypes: (entity as unknown as LidarrMetadataProfile).secondaryAlbumTypes,
        releaseStatuses: (entity as unknown as LidarrMetadataProfile).releaseStatuses,
      }),
      desiredComparable: (entity) => ({
        name: (entity as unknown as LidarrMetadataProfileCreatePayload).name,
        primaryAlbumTypes: (entity as unknown as LidarrMetadataProfileCreatePayload).primaryAlbumTypes,
        secondaryAlbumTypes: (entity as unknown as LidarrMetadataProfileCreatePayload).secondaryAlbumTypes,
        releaseStatuses: (entity as unknown as LidarrMetadataProfileCreatePayload).releaseStatuses,
      }),
      currentRemoteId: (entity) => (entity as unknown as LidarrMetadataProfile).id,
      arrayKeyStrategies: METADATA_PROFILE_ARRAY_KEY_STRATEGIES,
    });

    const result: MetadataProfilesPreview = {
      section: 'metadataProfiles',
      profile: profileChange,
    };

    return result;
  }

  override async sync(): Promise<SyncResult> {
    const lidarrClient = this.getLidarrClient();
    const syncConfig = arrSyncQueries.getMetadataProfilesSync(this.instanceId);

    if (!syncConfig.databaseId || !syncConfig.profileName) {
      await logger.debug('No metadata profile configured for sync', {
        source: 'Sync:MetadataProfile',
        meta: { instanceId: this.instanceId },
      });
      return { success: true, itemsSynced: 0, outcomes: [] };
    }

    const profileName = syncConfig.profileName;
    // Metadata profiles are Lidarr-only (getLidarrClient() throws above for other arr types),
    // so the outcome arrType is explicitly 'lidarr' — never inferred from a sibling.
    const outcome = (
      status: SyncEntityOutcome['status'],
      action: SyncEntityOutcome['action'],
      remoteId: string | null,
      reason: string | null
    ): SyncEntityOutcome => ({
      section: 'metadataProfiles',
      arrType: 'lidarr',
      entityType: 'metadataProfile',
      name: profileName,
      action,
      status,
      remoteId,
      reason,
    });

    const profile = await getMetadataProfileFromCache(syncConfig.databaseId, profileName);
    if (!profile) {
      await logger.warn(`Metadata profile "${profileName}" not found in database ${syncConfig.databaseId}`, {
        source: 'Sync:MetadataProfile',
        meta: {
          instanceId: this.instanceId,
          databaseId: syncConfig.databaseId,
          profileName,
        },
      });
      return {
        success: false,
        itemsSynced: 0,
        error: 'Profile not found in PCD cache',
        outcomes: [outcome('skipped', 'create', null, `Metadata profile "${profileName}" not found in its source database.`)],
      };
    }

    const namespaceIndex = arrNamespaceQueries.getOrCreate(this.instanceId, syncConfig.databaseId);
    const namespaceSuffix = getNamespaceSuffix(namespaceIndex);
    const suffixedProfileName = `${profile.name}${namespaceSuffix}`;

    let metadataSchema: LidarrMetadataProfileSchema | null = null;
    try {
      metadataSchema = await lidarrClient.getMetadataProfileSchema();
      if (!metadataSchema) {
        metadataSchema = null;
      }
    } catch (error) {
      const { message, response } = readErrorDetails(error);
      await logger.warn('Failed to load Lidarr metadata profile schema; using local values', {
        source: 'Sync:MetadataProfile',
        meta: {
          instanceId: this.instanceId,
          error: message,
          response,
        },
      });
    }

    const normalizedSchema = normalizeSchema(metadataSchema);

    const normalizedPayload = buildPayload(
      {
        ...profile,
        name: suffixedProfileName,
      },
      normalizedSchema
    );

    let writeOutcome: SyncEntityOutcome;
    try {
      const remoteProfiles = await lidarrClient.getMetadataProfiles();
      const existingProfile = findMatchingRemoteProfile(suffixedProfileName, remoteProfiles);

      if (existingProfile) {
        await lidarrClient.updateMetadataProfile(existingProfile.id, { ...normalizedPayload, id: existingProfile.id });

        await logger.info(`Updated metadata profile "${profile.name}" on "${this.instanceName}"`, {
          source: 'Sync:MetadataProfile',
          meta: {
            instanceId: this.instanceId,
            remoteId: existingProfile.id,
          },
        });
        writeOutcome = outcome('success', 'update', String(existingProfile.id), null);
      } else {
        const created = await lidarrClient.createMetadataProfile(normalizedPayload);

        await logger.info(`Created metadata profile "${profile.name}" on "${this.instanceName}"`, {
          source: 'Sync:MetadataProfile',
          meta: { instanceId: this.instanceId, remoteName: suffixedProfileName, remoteId: created.id },
        });
        writeOutcome = outcome('success', 'create', created.id != null ? String(created.id) : null, null);
      }
    } catch (error) {
      const { message: errorMsg, response } = readErrorDetails(error);
      const { reason } = sanitizeArrWriteError(error);
      await logger.error(`Failed to sync metadata profile "${profile.name}"`, {
        source: 'Sync:MetadataProfile',
        meta: { instanceId: this.instanceId, error: errorMsg, response },
      });
      return { success: false, itemsSynced: 0, error: errorMsg, outcomes: [outcome('failed', 'update', null, reason)] };
    }

    return { success: true, itemsSynced: 1, outcomes: [writeOutcome] };
  }

  // Base class abstract methods - implemented but not used since we override sync()
  protected async fetchFromPcd(): Promise<unknown[]> {
    return [];
  }

  private getMetadataProfilesSyncConfig(): { databaseId: number | null; profileName: string | null } {
    const previewConfig = parseMetadataProfilesPreviewConfig(this.getPreviewConfig());
    if (previewConfig) {
      return previewConfig;
    }

    return arrSyncQueries.getMetadataProfilesSync(this.instanceId);
  }

  protected transformToArr(_pcdData: unknown[]): unknown[] {
    return [];
  }

  protected async pushToArr(_arrData: unknown[]): Promise<void> {}

  private getLidarrClient(): LidarrClient {
    if (!(this.client instanceof LidarrClient)) {
      throw new Error('Metadata profile sync is only supported for Lidarr instances');
    }

    return this.client;
  }
}
