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
const REQUIRED_ALLOWED_ERROR = 'Each metadata profile section must include at least one allowed entry';

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeDescription(value: string | null): string | null {
  return value === null ? null : value.trim();
}

type NormalizedAlbumType = MetadataProfileAlbumTypeToggle;

function normalizeAlbumTypeRows(rows: MetadataProfileAlbumTypeToggle[]): NormalizedAlbumType[] {
  const seen = new Set<number>();
  const normalized: NormalizedAlbumType[] = [];
  let hasAllowed = false;

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

    const normalizedRow: NormalizedAlbumType = {
      typeId: row.typeId,
      name,
      allowed: !!row.allowed,
    };

    if (normalizedRow.allowed) {
      hasAllowed = true;
    }

    normalized.push(normalizedRow);
  }

  if (!hasAllowed) {
    throw new Error(REQUIRED_ALLOWED_ERROR);
  }

  return normalized;
}

type NormalizedReleaseStatus = MetadataProfileReleaseStatusToggle;

function normalizeReleaseStatusRows(rows: MetadataProfileReleaseStatusToggle[]): NormalizedReleaseStatus[] {
  const seen = new Set<number>();
  const normalized: NormalizedReleaseStatus[] = [];
  let hasAllowed = false;

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

    const normalizedRow: NormalizedReleaseStatus = {
      statusId: row.statusId,
      name,
      allowed: !!row.allowed,
    };

    if (normalizedRow.allowed) {
      hasAllowed = true;
    }

    normalized.push(normalizedRow);
  }

  if (!hasAllowed) {
    throw new Error(REQUIRED_ALLOWED_ERROR);
  }

  return normalized;
}

/**
 * Create a Lidarr metadata profile by writing an operation to the specified layer
 */
export async function create(options: CreateMetadataProfileOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;

  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);

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

  const primaryAlbumTypes = normalizeAlbumTypeRows(input.primaryAlbumTypes);
  const secondaryAlbumTypes = normalizeAlbumTypeRows(input.secondaryAlbumTypes);
  const releaseStatuses = normalizeReleaseStatusRows(input.releaseStatuses);

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
