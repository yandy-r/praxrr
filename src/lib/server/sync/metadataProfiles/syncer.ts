/**
 * Metadata profile syncer
 *
 * Syncs a single metadata profile from PCD to a Lidarr instance.
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { getCache } from '$pcd/index.ts';
import type {
  LidarrMetadataProfile as PcdMetadataProfile,
  MetadataProfileAlbumTypeToggle,
  MetadataProfileReleaseStatusToggle,
} from '$pcd/entities/metadataProfiles/read.ts';
import type {
  LidarrMetadataProfileCreatePayload,
  LidarrProfilePrimaryAlbumTypeItem,
  LidarrProfileReleaseStatusItem,
  LidarrProfileSecondaryAlbumTypeItem,
} from '$arr/types.ts';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { logger } from '$logger/logger.ts';

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

function transform(profile: PcdMetadataProfile): LidarrMetadataProfileCreatePayload {
  return {
    name: profile.name,
    primaryAlbumTypes: profile.primaryAlbumTypes.map(toPrimaryAlbumTypeItem),
    secondaryAlbumTypes: profile.secondaryAlbumTypes.map(toSecondaryAlbumTypeItem),
    releaseStatuses: profile.releaseStatuses.map(toReleaseStatusItem),
  };
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

    const lidarrClient = this.client as LidarrClient;
    const payload = transform(profile);

    try {
      const remoteProfiles = await lidarrClient.getMetadataProfiles();
      const existingProfile = findMatchingRemoteProfile(profile.name, remoteProfiles);

      if (existingProfile) {
        await lidarrClient.updateMetadataProfile(existingProfile.id, {
          ...payload,
          id: existingProfile.id,
        });

        await logger.info(`Updated metadata profile "${profile.name}" on "${this.instanceName}"`, {
          source: 'Sync:MetadataProfile',
          meta: {
            instanceId: this.instanceId,
            remoteId: existingProfile.id,
          },
        });
      } else {
        await lidarrClient.createMetadataProfile(payload);

        await logger.info(`Created metadata profile "${profile.name}" on "${this.instanceName}"`, {
          source: 'Sync:MetadataProfile',
          meta: { instanceId: this.instanceId },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await logger.error(`Failed to sync metadata profile "${profile.name}"`, {
        source: 'Sync:MetadataProfile',
        meta: { instanceId: this.instanceId, error: errorMsg },
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
