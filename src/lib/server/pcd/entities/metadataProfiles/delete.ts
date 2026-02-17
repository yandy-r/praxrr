/**
 * Delete a Lidarr metadata profile operation
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { LidarrMetadataProfile } from './read.ts';

interface RemoveMetadataProfileOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: LidarrMetadataProfile;
}

/**
 * Delete a Lidarr metadata profile with value guards
 */
export async function remove(options: RemoveMetadataProfileOptions) {
  const { databaseId, cache, layer, current } = options;
  const db = cache.kb;

  const queries = [];

  const deletePrimaryTypes = db
    .deleteFrom('lidarr_metadata_profile_primary_types')
    .where('metadata_profile_name', '=', current.name)
    .compile();
  queries.push(deletePrimaryTypes);

  const deleteSecondaryTypes = db
    .deleteFrom('lidarr_metadata_profile_secondary_types')
    .where('metadata_profile_name', '=', current.name)
    .compile();
  queries.push(deleteSecondaryTypes);

  const deleteReleaseStatuses = db
    .deleteFrom('lidarr_metadata_profile_release_statuses')
    .where('metadata_profile_name', '=', current.name)
    .compile();
  queries.push(deleteReleaseStatuses);

  let deleteProfile = db.deleteFrom('lidarr_metadata_profiles').where('name', '=', current.name);

  if (current.description === null) {
    deleteProfile = deleteProfile.where('description', 'is', null);
  } else {
    deleteProfile = deleteProfile.where('description', '=', current.description);
  }

  queries.push(deleteProfile.compile());

  const result = await writeOperation({
    databaseId,
    layer,
    description: `remove-lidarr-metadata-profile-${current.name}`,
    queries,
    desiredState: {
      deleted: true,
      name: current.name,
      description: current.description,
      primaryAlbumTypes: current.primaryAlbumTypes,
      secondaryAlbumTypes: current.secondaryAlbumTypes,
      releaseStatuses: current.releaseStatuses,
    },
    metadata: {
      operation: 'delete',
      entity: 'metadata_profile',
      name: current.name,
      stableKey: { key: 'metadata_profile_name', value: current.name },
      changedFields: ['deleted'],
      summary: 'Delete Lidarr metadata profile',
      title: `Delete Lidarr metadata profile "${current.name}"`,
    },
  });

  return result;
}
