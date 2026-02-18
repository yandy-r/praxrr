/**
 * Update a Lidarr metadata profile operation
 */

import type { PCDCache } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type {
  LidarrMetadataProfile,
  MetadataProfileAlbumTypeToggle,
  MetadataProfileReleaseStatusToggle,
} from './read.ts';

interface UpdateMetadataProfileInput {
  name?: string;
  description?: string | null;
  primaryAlbumTypes?: MetadataProfileAlbumTypeToggle[];
  secondaryAlbumTypes?: MetadataProfileAlbumTypeToggle[];
  releaseStatuses?: MetadataProfileReleaseStatusToggle[];
}

interface UpdateMetadataProfileOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: LidarrMetadataProfile;
  input: UpdateMetadataProfileInput;
}

const RESERVED_NAME = 'none';

type AlbumToggleArray = MetadataProfileAlbumTypeToggle[];
type ReleaseToggleArray = MetadataProfileReleaseStatusToggle[];

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeDescription(value: string | null): string | null {
  return value === null ? null : value.trim();
}

function normalizeAlbumTypeRows(rows: MetadataProfileAlbumTypeToggle[]): AlbumToggleArray {
  const seen = new Set<number>();
  const normalized: AlbumToggleArray = [];

  for (const row of rows) {
    if (!Number.isInteger(row.typeId)) {
      throw new Error('Each metadata profile primary/secondary type id must be an integer');
    }

    const name = row.name.trim();
    if (!name) {
      throw new Error('Metadata profile type names are required');
    }

    if (seen.has(row.typeId)) {
      throw new Error(`Duplicate metadata profile type id "${row.typeId}"`);
    }
    seen.add(row.typeId);

    const normalizedRow: MetadataProfileAlbumTypeToggle = {
      typeId: row.typeId,
      name,
      allowed: !!row.allowed,
    };

    normalized.push(normalizedRow);
  }

  return normalized;
}

function normalizeReleaseStatusRows(rows: MetadataProfileReleaseStatusToggle[]): ReleaseToggleArray {
  const seen = new Set<number>();
  const normalized: ReleaseToggleArray = [];

  for (const row of rows) {
    if (!Number.isInteger(row.statusId)) {
      throw new Error('Each metadata profile release status id must be an integer');
    }

    const name = row.name.trim();
    if (!name) {
      throw new Error('Metadata profile release status names are required');
    }

    if (seen.has(row.statusId)) {
      throw new Error(`Duplicate metadata profile release status id "${row.statusId}"`);
    }
    seen.add(row.statusId);

    const normalizedRow: MetadataProfileReleaseStatusToggle = {
      statusId: row.statusId,
      name,
      allowed: !!row.allowed,
    };

    normalized.push(normalizedRow);
  }

  return normalized;
}

function hasSameAlbumTypes(a: AlbumToggleArray, b: AlbumToggleArray): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bByTypeId = new Map<number, MetadataProfileAlbumTypeToggle>();
  for (const item of b) {
    bByTypeId.set(item.typeId, item);
  }

  return a.every((item) => {
    const other = bByTypeId.get(item.typeId);
    if (!other) return false;
    return other.name === item.name && other.allowed === item.allowed;
  });
}

function hasSameReleaseStatuses(a: ReleaseToggleArray, b: ReleaseToggleArray): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bByStatusId = new Map<number, MetadataProfileReleaseStatusToggle>();
  for (const item of b) {
    bByStatusId.set(item.statusId, item);
  }

  return a.every((item) => {
    const other = bByStatusId.get(item.statusId);
    if (!other) return false;
    return other.name === item.name && other.allowed === item.allowed;
  });
}

/**
 * Update a Lidarr metadata profile by writing an operation to the specified layer
 */
export async function update(options: UpdateMetadataProfileOptions) {
  const { databaseId, cache, layer, current, input } = options;
  const db = cache.kb;

  const nextName = input.name !== undefined ? normalizeName(input.name) : current.name;
  const nextDescription =
    input.description === undefined ? current.description : normalizeDescription(input.description);

  if (!nextName) {
    throw new Error('Metadata profile name is required');
  }

  const nameChanged = current.name !== nextName;

  if (nextName.toLowerCase() === RESERVED_NAME) {
    await logger.warn(`Reserved metadata profile name "${nextName}"`, {
      source: 'LidarrMetadataProfile',
      meta: { databaseId, name: nextName },
    });
    throw new Error("'None' is a reserved profile name");
  }

  if (nameChanged) {
    const existing = await db
      .selectFrom('lidarr_metadata_profiles')
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', nextName.toLowerCase()))
      .where('id', '!=', current.id)
      .select('name')
      .executeTakeFirst();

    if (existing) {
      await logger.warn(`Duplicate Lidarr metadata profile name "${nextName}"`, {
        source: 'LidarrMetadataProfile',
        meta: { databaseId, name: nextName },
      });
      throw new Error(`A Lidarr metadata profile with name "${nextName}" already exists`);
    }
  }

  const nextPrimaryAlbumTypes = input.primaryAlbumTypes
    ? normalizeAlbumTypeRows(input.primaryAlbumTypes)
    : current.primaryAlbumTypes;
  const nextSecondaryAlbumTypes = input.secondaryAlbumTypes
    ? normalizeAlbumTypeRows(input.secondaryAlbumTypes)
    : current.secondaryAlbumTypes;
  const nextReleaseStatuses = input.releaseStatuses
    ? normalizeReleaseStatusRows(input.releaseStatuses)
    : current.releaseStatuses;

  const descriptionChanged = input.description !== undefined && current.description !== nextDescription;
  const primaryChanged =
    input.primaryAlbumTypes !== undefined && !hasSameAlbumTypes(current.primaryAlbumTypes, nextPrimaryAlbumTypes);
  const secondaryChanged =
    input.secondaryAlbumTypes !== undefined && !hasSameAlbumTypes(current.secondaryAlbumTypes, nextSecondaryAlbumTypes);
  const releaseStatusesChanged =
    input.releaseStatuses !== undefined && !hasSameReleaseStatuses(current.releaseStatuses, nextReleaseStatuses);

  if (!nameChanged && !descriptionChanged && !primaryChanged && !secondaryChanged && !releaseStatusesChanged) {
    return { success: true };
  }

  const queries = [];
  const desiredState: Record<string, unknown> = {};
  const changedFields: string[] = [];

  if (primaryChanged) {
    changedFields.push('primaryAlbumTypes');

    for (const existingRow of current.primaryAlbumTypes) {
      queries.push(
        db
          .deleteFrom('lidarr_metadata_profile_primary_types')
          .where('metadata_profile_name', '=', current.name)
          .where('type_id', '=', existingRow.typeId)
          .where('name', '=', existingRow.name)
          .where('allowed', '=', existingRow.allowed ? 1 : 0)
          .compile()
      );
    }

    for (const albumType of nextPrimaryAlbumTypes) {
      queries.push(
        db
          .insertInto('lidarr_metadata_profile_primary_types')
          .values({
            metadata_profile_name: current.name,
            type_id: albumType.typeId,
            name: albumType.name,
            allowed: albumType.allowed ? 1 : 0,
          })
          .compile()
      );
    }

    desiredState.primaryAlbumTypes = {
      from: current.primaryAlbumTypes,
      to: nextPrimaryAlbumTypes,
    };
  }

  if (secondaryChanged) {
    changedFields.push('secondaryAlbumTypes');

    for (const existingRow of current.secondaryAlbumTypes) {
      queries.push(
        db
          .deleteFrom('lidarr_metadata_profile_secondary_types')
          .where('metadata_profile_name', '=', current.name)
          .where('type_id', '=', existingRow.typeId)
          .where('name', '=', existingRow.name)
          .where('allowed', '=', existingRow.allowed ? 1 : 0)
          .compile()
      );
    }

    for (const albumType of nextSecondaryAlbumTypes) {
      queries.push(
        db
          .insertInto('lidarr_metadata_profile_secondary_types')
          .values({
            metadata_profile_name: current.name,
            type_id: albumType.typeId,
            name: albumType.name,
            allowed: albumType.allowed ? 1 : 0,
          })
          .compile()
      );
    }

    desiredState.secondaryAlbumTypes = {
      from: current.secondaryAlbumTypes,
      to: nextSecondaryAlbumTypes,
    };
  }

  if (releaseStatusesChanged) {
    changedFields.push('releaseStatuses');

    for (const existingRow of current.releaseStatuses) {
      queries.push(
        db
          .deleteFrom('lidarr_metadata_profile_release_statuses')
          .where('metadata_profile_name', '=', current.name)
          .where('status_id', '=', existingRow.statusId)
          .where('name', '=', existingRow.name)
          .where('allowed', '=', existingRow.allowed ? 1 : 0)
          .compile()
      );
    }

    for (const status of nextReleaseStatuses) {
      queries.push(
        db
          .insertInto('lidarr_metadata_profile_release_statuses')
          .values({
            metadata_profile_name: current.name,
            status_id: status.statusId,
            name: status.name,
            allowed: status.allowed ? 1 : 0,
          })
          .compile()
      );
    }

    desiredState.releaseStatuses = {
      from: current.releaseStatuses,
      to: nextReleaseStatuses,
    };
  }

  if (nameChanged || descriptionChanged) {
    const setValues: Record<string, unknown> = {};

    if (nameChanged) {
      setValues.name = nextName;
      changedFields.push('name');
      desiredState.name = {
        from: current.name,
        to: nextName,
      };
    }

    if (descriptionChanged) {
      setValues.description = nextDescription;
      changedFields.push('description');
      desiredState.description = {
        from: current.description,
        to: nextDescription,
      };
    }

    let updateProfile = db.updateTable('lidarr_metadata_profiles').set(setValues).where('name', '=', current.name);

    if (current.description === null) {
      updateProfile = updateProfile.where('description', 'is', null);
    } else {
      updateProfile = updateProfile.where('description', '=', current.description);
    }

    queries.push(updateProfile.compile());
  }

  const result = await writeOperation({
    databaseId,
    layer,
    description: `update-lidarr-metadata-profile-${nextName}`,
    queries,
    desiredState,
    metadata: {
      operation: 'update',
      entity: 'metadata_profile',
      name: nextName,
      ...(nameChanged && { previousName: current.name }),
      stableKey: { key: 'metadata_profile_name', value: current.name },
      changedFields,
      summary: 'Update Lidarr metadata profile',
      title: `Update Lidarr metadata profile "${nextName}"`,
    },
  });

  return result;
}
