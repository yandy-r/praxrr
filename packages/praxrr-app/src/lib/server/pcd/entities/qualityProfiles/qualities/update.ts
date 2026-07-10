/**
 * Update quality profile qualities.
 *
 * Thin persister over the pure {@link buildQualityLadderOps} builder: build the guarded op set,
 * then write it as one batched, atomic {@link writeOperation}.
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import { buildQualityLadderOps, type UpdateQualitiesInput } from './buildQualityOps.ts';

export type { UpdateQualitiesInput } from './buildQualityOps.ts';

interface UpdateQualitiesOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  profileName: string;
  input: UpdateQualitiesInput;
}

/**
 * Update quality profile qualities configuration.
 */
export async function updateQualities(options: UpdateQualitiesOptions) {
  const { databaseId, cache, layer, profileName, input } = options;

  const built = await buildQualityLadderOps({ databaseId, cache, layer, profileName, input });
  if ('error' in built) {
    return { success: false, error: built.error };
  }
  if (built.batched === null) {
    return { success: true };
  }

  await logger.info(`Save quality profile qualities "${profileName}"`, {
    source: 'QualityProfile',
    meta: {
      profileName,
      rowOps: built.ops.length
    }
  });

  return writeOperation({
    databaseId,
    layer,
    description: `update-quality-profile-qualities-${profileName}`,
    queries: built.batched.queries,
    desiredState: built.batched.desiredState,
    metadata: {
      operation: 'update',
      entity: 'quality_profile',
      name: profileName,
      stableKey: { key: 'quality_profile_name', value: profileName },
      changedFields: built.batched.changedFields,
      summary: 'Update quality profile qualities',
      title: `Update qualities on quality profile "${profileName}"`
    }
  });
}
