/**
 * Metadata profile read operations
 */

import type { PCDCache } from '$pcd/index.ts';

export interface MetadataProfileAlbumTypeToggle {
  typeId: number;
  name: string;
  allowed: boolean;
}

export interface MetadataProfileReleaseStatusToggle {
  statusId: number;
  name: string;
  allowed: boolean;
}

export interface LidarrMetadataProfile {
  id: number;
  name: string;
  description: string | null;
  primaryAlbumTypes: MetadataProfileAlbumTypeToggle[];
  secondaryAlbumTypes: MetadataProfileAlbumTypeToggle[];
  releaseStatuses: MetadataProfileReleaseStatusToggle[];
}

interface PrimaryTypeRow {
  metadata_profile_name: string;
  type_id: number;
  name: string;
  allowed: number;
}

interface ReleaseStatusRow {
  metadata_profile_name: string;
  status_id: number;
  name: string;
  allowed: number;
}

function toAlbumTypeToggle(
  rows: Pick<PrimaryTypeRow, 'type_id' | 'name' | 'allowed'>[]
): MetadataProfileAlbumTypeToggle[] {
  return rows.map((row) => ({
    typeId: row.type_id,
    name: row.name,
    allowed: row.allowed === 1,
  }));
}

function toReleaseStatusToggle(
  rows: Pick<ReleaseStatusRow, 'status_id' | 'name' | 'allowed'>[]
): MetadataProfileReleaseStatusToggle[] {
  return rows.map((row) => ({
    statusId: row.status_id,
    name: row.name,
    allowed: row.allowed === 1,
  }));
}

/**
 * Get all Lidarr metadata profiles with full child toggles
 */
export async function list(cache: PCDCache): Promise<LidarrMetadataProfile[]> {
  const db = cache.kb;

  const profiles = await db
    .selectFrom('lidarr_metadata_profiles')
    .select(['id', 'name', 'description'])
    .orderBy('name')
    .execute();

  if (profiles.length === 0) {
    return [];
  }

  const names = profiles.map((profile) => profile.name);

  const [primaryRows, secondaryRows, statusRows] = await Promise.all([
    db
      .selectFrom('lidarr_metadata_profile_primary_types')
      .select(['metadata_profile_name', 'type_id', 'name', 'allowed'])
      .where('metadata_profile_name', 'in', names)
      .orderBy('metadata_profile_name')
      .orderBy('type_id')
      .execute(),
    db
      .selectFrom('lidarr_metadata_profile_secondary_types')
      .select(['metadata_profile_name', 'type_id', 'name', 'allowed'])
      .where('metadata_profile_name', 'in', names)
      .orderBy('metadata_profile_name')
      .orderBy('type_id')
      .execute(),
    db
      .selectFrom('lidarr_metadata_profile_release_statuses')
      .select(['metadata_profile_name', 'status_id', 'name', 'allowed'])
      .where('metadata_profile_name', 'in', names)
      .orderBy('metadata_profile_name')
      .orderBy('status_id')
      .execute(),
  ]);

  const byProfilePrimary = new Map<string, MetadataProfileAlbumTypeToggle[]>();
  const byProfileSecondary = new Map<string, MetadataProfileAlbumTypeToggle[]>();
  const byProfileStatus = new Map<string, MetadataProfileReleaseStatusToggle[]>();

  for (const row of primaryRows) {
    const existing = byProfilePrimary.get(row.metadata_profile_name) ?? [];
    existing.push({
      typeId: row.type_id,
      name: row.name,
      allowed: row.allowed === 1,
    });
    byProfilePrimary.set(row.metadata_profile_name, existing);
  }

  for (const row of secondaryRows) {
    const existing = byProfileSecondary.get(row.metadata_profile_name) ?? [];
    existing.push({
      typeId: row.type_id,
      name: row.name,
      allowed: row.allowed === 1,
    });
    byProfileSecondary.set(row.metadata_profile_name, existing);
  }

  for (const row of statusRows) {
    const existing = byProfileStatus.get(row.metadata_profile_name) ?? [];
    existing.push({
      statusId: row.status_id,
      name: row.name,
      allowed: row.allowed === 1,
    });
    byProfileStatus.set(row.metadata_profile_name, existing);
  }

  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    primaryAlbumTypes: byProfilePrimary.get(profile.name) ?? [],
    secondaryAlbumTypes: byProfileSecondary.get(profile.name) ?? [],
    releaseStatuses: byProfileStatus.get(profile.name) ?? [],
  }));
}

/**
 * Get a single Lidarr metadata profile by ID
 */
export async function get(cache: PCDCache, profileId: number): Promise<LidarrMetadataProfile | null> {
  const db = cache.kb;

  const profile = await db
    .selectFrom('lidarr_metadata_profiles')
    .select(['id', 'name', 'description'])
    .where('id', '=', profileId)
    .executeTakeFirst();

  if (!profile) {
    return null;
  }

  const [primaryRows, secondaryRows, statusRows] = await Promise.all([
    db
      .selectFrom('lidarr_metadata_profile_primary_types')
      .select(['type_id', 'name', 'allowed'])
      .where('metadata_profile_name', '=', profile.name)
      .orderBy('type_id')
      .execute(),
    db
      .selectFrom('lidarr_metadata_profile_secondary_types')
      .select(['type_id', 'name', 'allowed'])
      .where('metadata_profile_name', '=', profile.name)
      .orderBy('type_id')
      .execute(),
    db
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
    primaryAlbumTypes: toAlbumTypeToggle(primaryRows),
    secondaryAlbumTypes: toAlbumTypeToggle(secondaryRows),
    releaseStatuses: toReleaseStatusToggle(statusRows),
  };
}
