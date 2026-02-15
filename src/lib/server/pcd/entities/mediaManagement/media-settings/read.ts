/**
 * Media settings read operations (list and get)
 */

import type { PCDCache } from '$pcd/index.ts';
import type {
  LidarrMediaSettingsRow,
  RadarrMediaSettingsRow,
  SonarrMediaSettingsRow,
  MediaSettingsListItem,
} from '$shared/pcd/display.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

export async function list(cache: PCDCache): Promise<MediaSettingsListItem[]> {
  const db = cache.kb;

  const [radarrRows, lidarrRows, sonarrRows] = await Promise.all([
    db
      .selectFrom('radarr_media_settings')
      .select(['name', 'propers_repacks', 'enable_media_info', 'updated_at'])
      .execute(),
    db
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .select(['name', 'propers_repacks', 'enable_media_info', 'updated_at'])
      .execute(),
    db
      .selectFrom('sonarr_media_settings')
      .select(['name', 'propers_repacks', 'enable_media_info', 'updated_at'])
      .execute(),
  ]);

  const items: MediaSettingsListItem[] = [];

  for (const row of radarrRows) {
    items.push({
      name: row.name!,
      arr_type: 'radarr',
      propers_repacks: row.propers_repacks,
      enable_media_info: row.enable_media_info === 1,
      updated_at: row.updated_at,
    });
  }

  for (const row of lidarrRows) {
    items.push({
      name: row.name!,
      arr_type: 'lidarr',
      propers_repacks: row.propers_repacks,
      enable_media_info: row.enable_media_info === 1,
      updated_at: row.updated_at,
    });
  }

  for (const row of sonarrRows) {
    items.push({
      name: row.name!,
      arr_type: 'sonarr',
      propers_repacks: row.propers_repacks,
      enable_media_info: row.enable_media_info === 1,
      updated_at: row.updated_at,
    });
  }

  return items;
}

export async function getRadarrByName(cache: PCDCache, name: string): Promise<RadarrMediaSettingsRow | null> {
  const db = cache.kb;

  const row = await db.selectFrom('radarr_media_settings').selectAll().where('name', '=', name).executeTakeFirst();

  if (!row) return null;

  return {
    name: row.name!,
    propers_repacks: row.propers_repacks as RadarrMediaSettingsRow['propers_repacks'],
    enable_media_info: row.enable_media_info === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getSonarrByName(cache: PCDCache, name: string): Promise<SonarrMediaSettingsRow | null> {
  const db = cache.kb;

  const row = await db.selectFrom('sonarr_media_settings').selectAll().where('name', '=', name).executeTakeFirst();

  if (!row) return null;

  return {
    name: row.name!,
    propers_repacks: row.propers_repacks as SonarrMediaSettingsRow['propers_repacks'],
    enable_media_info: row.enable_media_info === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getLidarrByName(cache: PCDCache, name: string): Promise<LidarrMediaSettingsRow | null> {
  const db = cache.kb;

  const tableName = 'lidarr_media_settings' as keyof PCDDatabase;
  const row = await db.selectFrom(tableName).selectAll().where('name', '=', name).executeTakeFirst();

  if (!row) return null;

  return {
    name: row.name!,
    propers_repacks: row.propers_repacks as LidarrMediaSettingsRow['propers_repacks'],
    enable_media_info: row.enable_media_info === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
