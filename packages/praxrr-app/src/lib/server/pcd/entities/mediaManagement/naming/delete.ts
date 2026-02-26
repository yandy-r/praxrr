/**
 * Remove naming config operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { LidarrNamingRow, RadarrNamingRow, SonarrNamingRow } from '$shared/pcd/display.ts';
import { colonReplacementToDb, multiEpisodeStyleToDb } from '$shared/pcd/mediaManagement.ts';
import { LIDARR_NAMING_TABLE, RADARR_NAMING_TABLE, SONARR_NAMING_TABLE } from './constants.ts';

export interface RemoveRadarrNamingOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: RadarrNamingRow;
}

/**
 * Delete a Radarr naming config by writing an operation to the specified layer.
 * Uses value guards to detect conflicts with upstream changes.
 *
 * @param options - Delete options including databaseId, cache, layer, and current config data
 * @returns The write result from the delete operation
 */
export async function removeRadarrNaming(options: RemoveRadarrNamingOptions) {
  const { databaseId, cache, layer, current } = options;
  const db = cache.kb;

  const deleteQuery = db
    .deleteFrom(RADARR_NAMING_TABLE)
    .where('name', '=', current.name)
    .where('rename', '=', current.rename ? 1 : 0)
    .where('movie_format', '=', current.movie_format)
    .where('movie_folder_format', '=', current.movie_folder_format)
    .where('replace_illegal_characters', '=', current.replace_illegal_characters ? 1 : 0)
    .where('colon_replacement_format', '=', current.colon_replacement_format)
    .compile();

  return writeOperation({
    databaseId,
    layer,
    description: `delete-radarr-naming-${current.name}`,
    queries: [deleteQuery],
    desiredState: {
      deleted: true,
      name: current.name,
      rename: current.rename,
      movie_format: current.movie_format,
      movie_folder_format: current.movie_folder_format,
      replace_illegal_characters: current.replace_illegal_characters,
      colon_replacement_format: current.colon_replacement_format,
    },
    metadata: {
      operation: 'delete',
      entity: 'radarr_naming',
      name: current.name,
      stableKey: { key: 'radarr_naming_name', value: current.name },
      changedFields: ['deleted'],
      summary: 'Delete Radarr naming config',
      title: `Delete Radarr naming "${current.name}"`,
    },
  });
}

export interface RemoveSonarrNamingOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: SonarrNamingRow;
}

/**
 * Delete a Sonarr naming config by writing an operation to the specified layer.
 * Uses value guards to detect conflicts with upstream changes.
 *
 * @param options - Delete options including databaseId, cache, layer, and current config data
 * @returns The write result from the delete operation
 */
export async function removeSonarrNaming(options: RemoveSonarrNamingOptions) {
  const { databaseId, cache, layer, current } = options;
  const db = cache.kb;

  const currentColonReplacement = colonReplacementToDb(current.colon_replacement_format);
  const currentMultiEpisode = multiEpisodeStyleToDb(current.multi_episode_style);

  let deleteQuery = db
    .deleteFrom(SONARR_NAMING_TABLE)
    .where('name', '=', current.name)
    .where('rename', '=', current.rename ? 1 : 0)
    .where('standard_episode_format', '=', current.standard_episode_format)
    .where('daily_episode_format', '=', current.daily_episode_format)
    .where('anime_episode_format', '=', current.anime_episode_format)
    .where('series_folder_format', '=', current.series_folder_format)
    .where('season_folder_format', '=', current.season_folder_format)
    .where('replace_illegal_characters', '=', current.replace_illegal_characters ? 1 : 0)
    .where('colon_replacement_format', '=', currentColonReplacement)
    .where('multi_episode_style', '=', currentMultiEpisode);

  if (current.custom_colon_replacement_format === null) {
    deleteQuery = deleteQuery.where('custom_colon_replacement_format', 'is', null);
  } else {
    deleteQuery = deleteQuery.where('custom_colon_replacement_format', '=', current.custom_colon_replacement_format);
  }

  return writeOperation({
    databaseId,
    layer,
    description: `delete-sonarr-naming-${current.name}`,
    queries: [deleteQuery.compile()],
    desiredState: {
      deleted: true,
      name: current.name,
      rename: current.rename,
      standard_episode_format: current.standard_episode_format,
      daily_episode_format: current.daily_episode_format,
      anime_episode_format: current.anime_episode_format,
      series_folder_format: current.series_folder_format,
      season_folder_format: current.season_folder_format,
      replace_illegal_characters: current.replace_illegal_characters,
      colon_replacement_format: current.colon_replacement_format,
      custom_colon_replacement_format: current.custom_colon_replacement_format,
      multi_episode_style: current.multi_episode_style,
    },
    metadata: {
      operation: 'delete',
      entity: 'sonarr_naming',
      name: current.name,
      stableKey: { key: 'sonarr_naming_name', value: current.name },
      changedFields: ['deleted'],
      summary: 'Delete Sonarr naming config',
      title: `Delete Sonarr naming "${current.name}"`,
    },
  });
}

export interface RemoveLidarrNamingOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: LidarrNamingRow;
}

/**
 * Delete a Lidarr naming config by writing an operation to the specified layer.
 * Uses value guards to detect conflicts with upstream changes.
 *
 * @param options - Delete options including databaseId, cache, layer, and current config data
 * @returns The write result from the delete operation
 */
export async function removeLidarrNaming(options: RemoveLidarrNamingOptions) {
  const { databaseId, cache, layer, current } = options;
  const db = cache.kb;

  const currentColonReplacement = colonReplacementToDb(current.colon_replacement_format);

  let deleteQuery = db
    .deleteFrom(LIDARR_NAMING_TABLE)
    .where('name', '=', current.name)
    .where('rename', '=', current.rename ? 1 : 0)
    .where('standard_track_format', '=', current.standard_track_format)
    .where('artist_name', '=', current.artist_name)
    .where('multi_disc_track_format', '=', current.multi_disc_track_format)
    .where('artist_folder_format', '=', current.artist_folder_format)
    .where('replace_illegal_characters', '=', current.replace_illegal_characters ? 1 : 0)
    .where('colon_replacement_format', '=', currentColonReplacement);

  if (current.custom_colon_replacement_format === null) {
    deleteQuery = deleteQuery.where('custom_colon_replacement_format', 'is', null);
  } else {
    deleteQuery = deleteQuery.where('custom_colon_replacement_format', '=', current.custom_colon_replacement_format);
  }

  return writeOperation({
    databaseId,
    layer,
    description: `delete-lidarr-naming-${current.name}`,
    queries: [deleteQuery.compile()],
    desiredState: {
      deleted: true,
      name: current.name,
      rename: current.rename,
      standard_track_format: current.standard_track_format,
      artist_name: current.artist_name,
      multi_disc_track_format: current.multi_disc_track_format,
      artist_folder_format: current.artist_folder_format,
      replace_illegal_characters: current.replace_illegal_characters,
      colon_replacement_format: current.colon_replacement_format,
      custom_colon_replacement_format: current.custom_colon_replacement_format,
    },
    metadata: {
      operation: 'delete',
      entity: 'lidarr_naming',
      name: current.name,
      stableKey: { key: 'lidarr_naming_name', value: current.name },
      changedFields: ['deleted'],
      summary: 'Delete Lidarr naming config',
      title: `Delete Lidarr naming "${current.name}"`,
    },
  });
}
