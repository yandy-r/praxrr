/**
 * Create naming config operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { LidarrNamingRow, RadarrNamingRow, SonarrNamingRow } from '$shared/pcd/display.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { colonReplacementToDb, multiEpisodeStyleToDb } from '$shared/pcd/mediaManagement.ts';
import { LIDARR_NAMING_TABLE, RADARR_NAMING_TABLE, SONARR_NAMING_TABLE } from './constants.ts';

export interface CreateRadarrNamingInput {
  name: string;
  rename: boolean;
  movieFormat: string;
  movieFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: RadarrNamingRow['colon_replacement_format'];
}

export interface CreateRadarrNamingOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  input: CreateRadarrNamingInput;
}

/**
 * Create a Radarr naming config by writing an operation to the specified layer.
 *
 * @param options - Create options including databaseId, cache, layer, and input values
 * @returns The write result from the create operation
 * @throws {Error} When a naming config with the same name already exists
 */
export async function createRadarrNaming(options: CreateRadarrNamingOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;

  // Check if name already exists
  const existing = await db
    .selectFrom(RADARR_NAMING_TABLE)
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    throw new Error(`A radarr naming config with name "${input.name}" already exists`);
  }

  const insertQuery = db
    .insertInto(RADARR_NAMING_TABLE)
    .values({
      name: input.name,
      rename: input.rename ? 1 : 0,
      movie_format: input.movieFormat,
      movie_folder_format: input.movieFolderFormat,
      replace_illegal_characters: input.replaceIllegalCharacters ? 1 : 0,
      colon_replacement_format: input.colonReplacementFormat,
    })
    .compile();

  return writeOperation({
    databaseId,
    layer,
    description: `create-radarr-naming-${input.name}`,
    queries: [insertQuery],
    desiredState: {
      name: input.name,
      rename: input.rename,
      movie_format: input.movieFormat,
      movie_folder_format: input.movieFolderFormat,
      replace_illegal_characters: input.replaceIllegalCharacters,
      colon_replacement_format: input.colonReplacementFormat,
    },
    metadata: {
      operation: 'create',
      entity: 'radarr_naming',
      name: input.name,
      stableKey: { key: 'radarr_naming_name', value: input.name },
      summary: 'Create Radarr naming config',
      title: `Create Radarr naming "${input.name}"`,
    },
  });
}

export interface CreateSonarrNamingInput {
  name: string;
  rename: boolean;
  standardEpisodeFormat: string;
  dailyEpisodeFormat: string;
  animeEpisodeFormat: string;
  seriesFolderFormat: string;
  seasonFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: SonarrNamingRow['colon_replacement_format'];
  customColonReplacementFormat: string | null;
  multiEpisodeStyle: SonarrNamingRow['multi_episode_style'];
}

export interface CreateSonarrNamingOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  input: CreateSonarrNamingInput;
}

type SonarrNamingType = 'sonarr';

async function createSonarrNamingInternal(options: CreateSonarrNamingOptions, namingType: SonarrNamingType) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;
  const normalizedType = 'Sonarr';

  const existing = await db
    .selectFrom(SONARR_NAMING_TABLE)
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    throw new Error(`A ${namingType} naming config with name "${input.name}" already exists`);
  }

  const insertQuery = db
    .insertInto(SONARR_NAMING_TABLE)
    .values({
      name: input.name,
      rename: input.rename ? 1 : 0,
      standard_episode_format: input.standardEpisodeFormat,
      daily_episode_format: input.dailyEpisodeFormat,
      anime_episode_format: input.animeEpisodeFormat,
      series_folder_format: input.seriesFolderFormat,
      season_folder_format: input.seasonFolderFormat,
      replace_illegal_characters: input.replaceIllegalCharacters ? 1 : 0,
      colon_replacement_format: colonReplacementToDb(input.colonReplacementFormat),
      custom_colon_replacement_format: input.customColonReplacementFormat,
      multi_episode_style: multiEpisodeStyleToDb(input.multiEpisodeStyle),
    })
    .compile();

  return writeOperation({
    databaseId,
    layer,
    description: `create-${namingType}-naming-${input.name}`,
    queries: [insertQuery],
    desiredState: {
      name: input.name,
      rename: input.rename,
      standard_episode_format: input.standardEpisodeFormat,
      daily_episode_format: input.dailyEpisodeFormat,
      anime_episode_format: input.animeEpisodeFormat,
      series_folder_format: input.seriesFolderFormat,
      season_folder_format: input.seasonFolderFormat,
      replace_illegal_characters: input.replaceIllegalCharacters,
      colon_replacement_format: input.colonReplacementFormat,
      custom_colon_replacement_format: input.customColonReplacementFormat,
      multi_episode_style: input.multiEpisodeStyle,
    },
    metadata: {
      operation: 'create',
      entity: 'sonarr_naming',
      name: input.name,
      stableKey: { key: 'sonarr_naming_name', value: input.name },
      summary: `Create ${normalizedType} naming config`,
      title: `Create ${normalizedType} naming "${input.name}"`,
    },
  });
}

/**
 * Create a Sonarr naming config by writing an operation to the specified layer.
 *
 * @param options - Create options including databaseId, cache, layer, and input values
 * @returns The write result from the create operation
 * @throws {Error} When a naming config with the same name already exists
 */
export async function createSonarrNaming(options: CreateSonarrNamingOptions) {
  return createSonarrNamingInternal(options, 'sonarr');
}

interface LegacyPortableLidarrNamingInput {
  standardEpisodeFormat?: string;
  dailyEpisodeFormat?: string;
  animeEpisodeFormat?: string;
  seriesFolderFormat?: string;
}

export interface CreateLidarrNamingInput extends LegacyPortableLidarrNamingInput {
  name: string;
  rename: boolean;
  standardTrackFormat?: string;
  artistName?: string;
  multiDiscTrackFormat?: string;
  artistFolderFormat?: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: LidarrNamingRow['colon_replacement_format'];
  customColonReplacementFormat: string | null;
}

export interface CreateLidarrNamingOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  input: CreateLidarrNamingInput;
}

const LIDARR_DEFAULT_ARTIST_NAME = '{Artist Name}';

function normalizeLidarrNamingInput(input: CreateLidarrNamingInput) {
  const standardTrackFormat = input.standardTrackFormat ?? input.standardEpisodeFormat ?? '';
  const artistName =
    (input.artistName ?? input.dailyEpisodeFormat ?? LIDARR_DEFAULT_ARTIST_NAME).trim() || LIDARR_DEFAULT_ARTIST_NAME;
  const multiDiscTrackFormat = input.multiDiscTrackFormat ?? input.animeEpisodeFormat ?? '';
  const artistFolderFormat = input.artistFolderFormat ?? input.seriesFolderFormat ?? '';

  return {
    standardTrackFormat,
    artistName,
    multiDiscTrackFormat,
    artistFolderFormat,
  };
}

/**
 * Create a Lidarr naming config by writing an operation to the specified layer.
 *
 * @param options - Create options including databaseId, cache, layer, and input values
 * @returns The write result from the create operation
 * @throws {Error} When a naming config with the same name already exists
 */
export async function createLidarrNaming(options: CreateLidarrNamingOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;
  const tableName = LIDARR_NAMING_TABLE as keyof PCDDatabase;

  const existing = await db
    .selectFrom(tableName)
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    throw new Error(`A lidarr naming config with name "${input.name}" already exists`);
  }

  const normalized = normalizeLidarrNamingInput(input);
  if (!normalized.standardTrackFormat.trim()) {
    throw new Error('Standard track format is required');
  }
  if (!normalized.multiDiscTrackFormat.trim()) {
    throw new Error('Multi-disc track format is required');
  }
  if (!normalized.artistFolderFormat.trim()) {
    throw new Error('Artist folder format is required');
  }

  const insertQuery = db
    .insertInto(tableName)
    .values({
      name: input.name,
      rename: input.rename ? 1 : 0,
      standard_track_format: normalized.standardTrackFormat,
      artist_name: normalized.artistName,
      multi_disc_track_format: normalized.multiDiscTrackFormat,
      artist_folder_format: normalized.artistFolderFormat,
      replace_illegal_characters: input.replaceIllegalCharacters ? 1 : 0,
      colon_replacement_format: colonReplacementToDb(input.colonReplacementFormat),
      custom_colon_replacement_format: input.customColonReplacementFormat,
    })
    .compile();

  return writeOperation({
    databaseId,
    layer,
    description: `create-lidarr-naming-${input.name}`,
    queries: [insertQuery],
    desiredState: {
      name: input.name,
      rename: input.rename,
      standard_track_format: normalized.standardTrackFormat,
      artist_name: normalized.artistName,
      multi_disc_track_format: normalized.multiDiscTrackFormat,
      artist_folder_format: normalized.artistFolderFormat,
      replace_illegal_characters: input.replaceIllegalCharacters,
      colon_replacement_format: input.colonReplacementFormat,
      custom_colon_replacement_format: input.customColonReplacementFormat,
    },
    metadata: {
      operation: 'create',
      entity: 'lidarr_naming',
      name: input.name,
      stableKey: { key: 'lidarr_naming_name', value: input.name },
      summary: 'Create Lidarr naming config',
      title: `Create Lidarr naming "${input.name}"`,
    },
  });
}
