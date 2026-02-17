/**
 * Metadata profile syncer
 *
 * Syncs a single metadata profile from PCD to a Lidarr instance.
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
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
  LidarrMetadataProfileSchema,
  LidarrProfilePrimaryAlbumTypeItem,
  LidarrProfileReleaseStatusItem,
  LidarrProfileSecondaryAlbumTypeItem,
} from '$arr/types.ts';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { getNamespaceSuffix } from '../namespace.ts';
import { logger } from '$logger/logger.ts';
import { HttpError } from '$http/types.ts';

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

function buildPayload(profile: PcdMetadataProfile, schema?: LidarrMetadataProfileSchema | null): LidarrMetadataProfileCreatePayload {
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

function normalizeSchema(
  schema: LidarrMetadataProfileSchema | null | undefined
): LidarrMetadataProfileSchema {
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
    primaryAlbumTypes: Array.isArray(schema.primaryAlbumTypes) && schema.primaryAlbumTypes.length > 0
      ? schema.primaryAlbumTypes
      : METADATA_PROFILE_SCHEMA_FALLBACK.primaryAlbumTypes,
    secondaryAlbumTypes: Array.isArray(schema.secondaryAlbumTypes) && schema.secondaryAlbumTypes.length > 0
      ? schema.secondaryAlbumTypes
      : METADATA_PROFILE_SCHEMA_FALLBACK.secondaryAlbumTypes,
    releaseStatuses: Array.isArray(schema.releaseStatuses) && schema.releaseStatuses.length > 0
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

function findMatchingRemoteProfile(profileName: string, remoteProfiles: Array<{ id: number; name: string }>): { id: number; name: string } | undefined {
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

  override async sync(): Promise<SyncResult> {
    const syncConfig = arrSyncQueries.getMetadataProfilesSync(this.instanceId);

    if (!syncConfig.databaseId || !syncConfig.profileName) {
      await logger.debug('No metadata profile configured for sync', {
        source: 'Sync:MetadataProfile',
        meta: { instanceId: this.instanceId },
      });
      return { success: true, itemsSynced: 0 };
    }

    const profile = await getMetadataProfileFromCache(syncConfig.databaseId, syncConfig.profileName);
    if (!profile) {
      await logger.warn(
        `Metadata profile "${syncConfig.profileName}" not found in database ${syncConfig.databaseId}`,
        {
          source: 'Sync:MetadataProfile',
          meta: {
            instanceId: this.instanceId,
            databaseId: syncConfig.databaseId,
            profileName: syncConfig.profileName,
          },
        }
      );
      return { success: false, itemsSynced: 0, error: 'Profile not found in PCD cache' };
    }

    const namespaceIndex = arrNamespaceQueries.getOrCreate(this.instanceId, syncConfig.databaseId);
    const namespaceSuffix = getNamespaceSuffix(namespaceIndex);
    const suffixedProfileName = `${profile.name}${namespaceSuffix}`;

    const lidarrClient = this.client as LidarrClient;
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
      } else {
        await lidarrClient.createMetadataProfile(normalizedPayload);

        await logger.info(`Created metadata profile "${profile.name}" on "${this.instanceName}"`, {
          source: 'Sync:MetadataProfile',
          meta: { instanceId: this.instanceId, remoteName: suffixedProfileName },
        });
      }
    } catch (error) {
      const { message: errorMsg, response } = readErrorDetails(error);
      await logger.error(`Failed to sync metadata profile "${profile.name}"`, {
        source: 'Sync:MetadataProfile',
        meta: { instanceId: this.instanceId, error: errorMsg, response },
      });
      return { success: false, itemsSynced: 0, error: errorMsg };
    }

    return { success: true, itemsSynced: 1 };
  }

  // Base class abstract methods - implemented but not used since we override sync()
  protected async fetchFromPcd(): Promise<unknown[]> {
    return [];
  }

  protected transformToArr(_pcdData: unknown[]): unknown[] {
    return [];
  }

  protected async pushToArr(_arrData: unknown[]): Promise<void> {}
}
