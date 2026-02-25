/**
 * Naming read operations (list and get)
 */

import type { PCDCache } from '$pcd/index.ts';
import type { LidarrNamingRow, NamingListItem, RadarrNamingRow, SonarrNamingRow } from '$shared/pcd/display.ts';
import { colonReplacementFromDb, multiEpisodeStyleFromDb } from '$shared/pcd/mediaManagement.ts';
import { LIDARR_NAMING_TABLE, RADARR_NAMING_TABLE, SONARR_NAMING_TABLE } from './constants.ts';

// Note: name is PRIMARY KEY so never null, but Kysely types it as nullable
// because the generator doesn't detect non-INTEGER primary keys

export async function list(cache: PCDCache): Promise<NamingListItem[]> {
  const db = cache.kb;

  const [radarrRows, lidarrRows, sonarrRows] = await Promise.all([
    db.selectFrom(RADARR_NAMING_TABLE).select(['name', 'rename', 'updated_at']).execute(),
    db.selectFrom(LIDARR_NAMING_TABLE).select(['name', 'rename', 'updated_at']).execute(),
    db.selectFrom(SONARR_NAMING_TABLE).select(['name', 'rename', 'updated_at']).execute(),
  ]);

  const items: NamingListItem[] = [];

  for (const row of radarrRows) {
    items.push({
      name: row.name!,
      arr_type: 'radarr',
      rename: row.rename === 1,
      updated_at: row.updated_at,
    });
  }

  for (const row of lidarrRows) {
    items.push({
      name: row.name!,
      arr_type: 'lidarr',
      rename: row.rename === 1,
      updated_at: row.updated_at,
    });
  }

  for (const row of sonarrRows) {
    items.push({
      name: row.name!,
      arr_type: 'sonarr',
      rename: row.rename === 1,
      updated_at: row.updated_at,
    });
  }

  return items;
}

// deno-lint-ignore no-explicit-any
function mapRadarrRow(row: Record<string, any>): RadarrNamingRow {
  return {
    name: row.name!,
    rename: row.rename === 1,
    movie_format: row.movie_format,
    movie_folder_format: row.movie_folder_format,
    replace_illegal_characters: row.replace_illegal_characters === 1,
    colon_replacement_format: row.colon_replacement_format as RadarrNamingRow['colon_replacement_format'],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// deno-lint-ignore no-explicit-any
function mapSonarrRow(row: Record<string, any>): SonarrNamingRow {
  return {
    name: row.name!,
    rename: row.rename === 1,
    standard_episode_format: row.standard_episode_format,
    daily_episode_format: row.daily_episode_format,
    anime_episode_format: row.anime_episode_format,
    series_folder_format: row.series_folder_format,
    season_folder_format: row.season_folder_format,
    replace_illegal_characters: row.replace_illegal_characters === 1,
    colon_replacement_format: colonReplacementFromDb(row.colon_replacement_format),
    custom_colon_replacement_format: row.custom_colon_replacement_format,
    multi_episode_style: multiEpisodeStyleFromDb(row.multi_episode_style),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// deno-lint-ignore no-explicit-any
function mapLidarrRow(row: Record<string, any>): LidarrNamingRow {
  return {
    name: row.name!,
    rename: row.rename === 1,
    standard_track_format: row.standard_track_format,
    artist_name: row.artist_name,
    multi_disc_track_format: row.multi_disc_track_format,
    artist_folder_format: row.artist_folder_format,
    replace_illegal_characters: row.replace_illegal_characters === 1,
    colon_replacement_format: colonReplacementFromDb(row.colon_replacement_format),
    custom_colon_replacement_format: row.custom_colon_replacement_format,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getRadarrByName(cache: PCDCache, name: string): Promise<RadarrNamingRow | null> {
  const row = await cache.kb.selectFrom(RADARR_NAMING_TABLE).selectAll().where('name', '=', name).executeTakeFirst();
  return row ? mapRadarrRow(row) : null;
}

export async function getSonarrByName(cache: PCDCache, name: string): Promise<SonarrNamingRow | null> {
  const row = await cache.kb.selectFrom(SONARR_NAMING_TABLE).selectAll().where('name', '=', name).executeTakeFirst();
  return row ? mapSonarrRow(row) : null;
}

export async function getLidarrByName(cache: PCDCache, name: string): Promise<LidarrNamingRow | null> {
  const row = await cache.kb.selectFrom(LIDARR_NAMING_TABLE).selectAll().where('name', '=', name).executeTakeFirst();
  return row ? mapLidarrRow(row) : null;
}

export async function getRadarrDefaults(cache: PCDCache): Promise<RadarrNamingRow | null> {
  const row = await cache.kb
    .selectFrom(RADARR_NAMING_TABLE)
    .selectAll()
    .orderBy('created_at', 'asc')
    .executeTakeFirst();
  return row ? mapRadarrRow(row) : null;
}

export async function getSonarrDefaults(cache: PCDCache): Promise<SonarrNamingRow | null> {
  const row = await cache.kb
    .selectFrom(SONARR_NAMING_TABLE)
    .selectAll()
    .orderBy('created_at', 'asc')
    .executeTakeFirst();
  return row ? mapSonarrRow(row) : null;
}

export async function getLidarrDefaults(cache: PCDCache): Promise<LidarrNamingRow | null> {
  const row = await cache.kb
    .selectFrom(LIDARR_NAMING_TABLE)
    .selectAll()
    .orderBy('created_at', 'asc')
    .executeTakeFirst();
  return row ? mapLidarrRow(row) : null;
}
