import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager, canWriteToBase } from '$pcd/index.ts';
import * as metadataProfileQueries from '$pcd/entities/metadataProfiles/index.ts';
import type { LidarrMetadataProfileListItem } from '$shared/pcd/display.ts';

export const load: ServerLoad = async ({ params }) => {
  const { databaseId } = params;

  if (!databaseId) {
    throw error(400, 'Missing database ID');
  }

  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  const databases = pcdManager.getAll();
  const currentDatabase = databases.find((database) => database.id === currentDatabaseId);
  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(500, 'Database cache not available');
  }

  const metadataProfiles = await metadataProfileQueries.list(cache);
  const metadataProfileNames = metadataProfiles.map((profile) => profile.name);
  const metadataProfileRows = metadataProfileNames.length
    ? await cache.kb
        .selectFrom('lidarr_metadata_profiles')
        .select(['id', 'updated_at'])
        .where('name', 'in', metadataProfileNames)
        .execute()
    : [];

  const updatedAtById = new Map<number, string>(metadataProfileRows.map((row) => [row.id, row.updated_at]));

  const metadataProfileListItems: LidarrMetadataProfileListItem[] = metadataProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    updated_at: updatedAtById.get(profile.id) ?? '',
    primaryTypeCount: profile.primaryAlbumTypes.length,
    secondaryTypeCount: profile.secondaryAlbumTypes.length,
    releaseStatusCount: profile.releaseStatuses.length,
    primaryAllowedCount: profile.primaryAlbumTypes.filter((entry) => entry.allowed).length,
    secondaryAllowedCount: profile.secondaryAlbumTypes.filter((entry) => entry.allowed).length,
    releaseStatusAllowedCount: profile.releaseStatuses.filter((entry) => entry.allowed).length,
  }));

  return {
    databases,
    currentDatabase,
    metadataProfiles: metadataProfileListItems,
    canWriteToBase: canWriteToBase(currentDatabaseId),
  };
};
