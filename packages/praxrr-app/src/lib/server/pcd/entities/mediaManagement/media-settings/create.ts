/**
 * Create media settings config operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { RadarrMediaSettingsRow } from '$shared/pcd/display.ts';

export interface CreateMediaSettingsInput {
  name: string;
  propersRepacks: RadarrMediaSettingsRow['propers_repacks'];
  enableMediaInfo: boolean;
}

export interface CreateMediaSettingsOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  input: CreateMediaSettingsInput;
}

/**
 * Create a Radarr media settings config by writing an operation to the specified layer.
 *
 * @param options - Create options including databaseId, cache, layer, and input values
 * @returns The write result from the create operation
 * @throws {Error} When a media settings config with the same name already exists
 */
export async function createRadarrMediaSettings(options: CreateMediaSettingsOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;

  // Check if name already exists
  const existing = await db
    .selectFrom('radarr_media_settings')
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    throw new Error(`A radarr media settings config with name "${input.name}" already exists`);
  }

  const insertQuery = db
    .insertInto('radarr_media_settings')
    .values({
      name: input.name,
      propers_repacks: input.propersRepacks,
      enable_media_info: input.enableMediaInfo ? 1 : 0,
    })
    .compile();

  return writeOperation({
    databaseId,
    layer,
    description: `create-radarr-media-settings-${input.name}`,
    queries: [insertQuery],
    desiredState: {
      name: input.name,
      propers_repacks: input.propersRepacks,
      enable_media_info: input.enableMediaInfo,
    },
    metadata: {
      operation: 'create',
      entity: 'radarr_media_settings',
      name: input.name,
      stableKey: { key: 'radarr_media_settings_name', value: input.name },
      summary: 'Create Radarr media settings',
      title: `Create Radarr media settings "${input.name}"`,
    },
  });
}

/**
 * Create a Sonarr media settings config by writing an operation to the specified layer.
 *
 * @param options - Create options including databaseId, cache, layer, and input values
 * @returns The write result from the create operation
 * @throws {Error} When a media settings config with the same name already exists
 */
export async function createSonarrMediaSettings(options: CreateMediaSettingsOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;

  // Check if name already exists
  const existing = await db
    .selectFrom('sonarr_media_settings')
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    throw new Error(`A sonarr media settings config with name "${input.name}" already exists`);
  }

  const insertQuery = db
    .insertInto('sonarr_media_settings')
    .values({
      name: input.name,
      propers_repacks: input.propersRepacks,
      enable_media_info: input.enableMediaInfo ? 1 : 0,
    })
    .compile();

  return writeOperation({
    databaseId,
    layer,
    description: `create-sonarr-media-settings-${input.name}`,
    queries: [insertQuery],
    desiredState: {
      name: input.name,
      propers_repacks: input.propersRepacks,
      enable_media_info: input.enableMediaInfo,
    },
    metadata: {
      operation: 'create',
      entity: 'sonarr_media_settings',
      name: input.name,
      stableKey: { key: 'sonarr_media_settings_name', value: input.name },
      summary: 'Create Sonarr media settings',
      title: `Create Sonarr media settings "${input.name}"`,
    },
  });
}

/**
 * Create a Lidarr media settings config by writing an operation to the specified layer.
 *
 * @param options - Create options including databaseId, cache, layer, and input values
 * @returns The write result from the create operation
 * @throws {Error} When a media settings config with the same name already exists
 */
export async function createLidarrMediaSettings(options: CreateMediaSettingsOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;

  const tableName = 'lidarr_media_settings' as keyof PCDDatabase;
  const existing = await db
    .selectFrom(tableName)
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    throw new Error(`A lidarr media settings config with name "${input.name}" already exists`);
  }

  const insertQuery = db
    .insertInto(tableName)
    .values({
      name: input.name,
      propers_repacks: input.propersRepacks,
      enable_media_info: input.enableMediaInfo ? 1 : 0,
    })
    .compile();

  return writeOperation({
    databaseId,
    layer,
    description: `create-lidarr-media-settings-${input.name}`,
    queries: [insertQuery],
    desiredState: {
      name: input.name,
      propers_repacks: input.propersRepacks,
      enable_media_info: input.enableMediaInfo,
    },
    metadata: {
      operation: 'create',
      entity: 'lidarr_media_settings',
      name: input.name,
      stableKey: { key: 'lidarr_media_settings_name', value: input.name },
      summary: 'Create Lidarr media settings',
      title: `Create Lidarr media settings "${input.name}"`,
    },
  });
}
