/**
 * Create a Lidarr metadata profile operation
 */

import type { PCDCache } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { LidarrMetadataProfile, MetadataProfileAlbumTypeToggle, MetadataProfileReleaseStatusToggle } from './read.ts';

interface CreateMetadataProfileInput {
  name: string;
  description: string | null;
  primaryAlbumTypes: MetadataProfileAlbumTypeToggle[];
  secondaryAlbumTypes: MetadataProfileAlbumTypeToggle[];
  releaseStatuses: MetadataProfileReleaseStatusToggle[];
}

interface CreateMetadataProfileOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  input: CreateMetadataProfileInput;
}

const RESERVED_NAME = 'none';

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeDescription(value: string | null): string | null {
  return value === null ? null : value.trim();
}

function normalizeAlbumTypeRows(rows: MetadataProfileAlbumTypeToggle[]) {
  return rows.map((row) => ({
    typeId: row.typeId,
    name: row.name,
    allowed: !!row.allowed,
  }));
}

function normalizeReleaseStatusRows(rows: MetadataProfileReleaseStatusToggle[]) {
  return rows.map((row) => ({
    statusId: row.statusId,
    name: row.name,
    allowed: !!row.allowed,
  }));
}

/**
 * Create a Lidarr metadata profile by writing an operation to the specified layer
 */
export async function create(options: CreateMetadataProfileOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;

  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  const primaryAlbumTypes = normalizeAlbumTypeRows(input.primaryAlbumTypes);
  const secondaryAlbumTypes = normalizeAlbumTypeRows(input.secondaryAlbumTypes);
  const releaseStatuses = normalizeReleaseStatusRows(input.releaseStatuses);

  if (name.toLowerCase() === RESERVED_NAME) {
    await logger.warn(`Reserved metadata profile name "${name}"`, {
      source: 'LidarrMetadataProfile',
      meta: { databaseId, name },
    });
    throw new Error("'None' is a reserved profile name");
  }

  if (!name) {
    throw new Error('Metadata profile name is required');
  }

  const existing = await db
    .selectFrom('lidarr_metadata_profiles')
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    await logger.warn(`Duplicate Lidarr metadata profile name "${name}"`, {
      source: 'LidarrMetadataProfile',
      meta: { databaseId, name },
    });
    throw new Error(`A Lidarr metadata profile with name "${name}" already exists`);
  }

  const queries = [
    db
      .insertInto('lidarr_metadata_profiles')
      .values({
        name,
        description,
      })
      .compile(),
  ];

  for (const albumType of primaryAlbumTypes) {
    queries.push(
      db
        .insertInto('lidarr_metadata_profile_primary_types')
        .values({
          metadata_profile_name: name,
          type_id: albumType.typeId,
          name: albumType.name,
          allowed: albumType.allowed ? 1 : 0,
        })
        .compile()
    );
  }

  for (const albumType of secondaryAlbumTypes) {
    queries.push(
      db
        .insertInto('lidarr_metadata_profile_secondary_types')
        .values({
          metadata_profile_name: name,
          type_id: albumType.typeId,
          name: albumType.name,
          allowed: albumType.allowed ? 1 : 0,
        })
        .compile()
    );
  }

  for (const status of releaseStatuses) {
    queries.push(
      db
        .insertInto('lidarr_metadata_profile_release_statuses')
        .values({
          metadata_profile_name: name,
          status_id: status.statusId,
          name: status.name,
          allowed: status.allowed ? 1 : 0,
        })
        .compile()
    );
  }

  return writeOperation({
    databaseId,
    layer,
    description: `create-lidarr-metadata-profile-${name}`,
    queries,
    desiredState: {
      name,
      description,
      primaryAlbumTypes,
      secondaryAlbumTypes,
      releaseStatuses,
    } satisfies Partial<LidarrMetadataProfile>,
    metadata: {
      operation: 'create',
      entity: 'metadata_profile',
      name,
      stableKey: { key: 'metadata_profile_name', value: name },
      summary: 'Create Lidarr metadata profile',
      title: `Create Lidarr metadata profile "${name}"`,
    },
  });
}
