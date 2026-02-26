/**
 * Update media settings config operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { LidarrMediaSettingsRow, RadarrMediaSettingsRow, SonarrMediaSettingsRow } from '$shared/pcd/display.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

export interface UpdateMediaSettingsInput {
  name: string;
  propersRepacks: RadarrMediaSettingsRow['propers_repacks'];
  enableMediaInfo: boolean;
}

export interface UpdateMediaSettingsOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: RadarrMediaSettingsRow;
  input: UpdateMediaSettingsInput;
}

/**
 * Update a Radarr media settings config by writing an operation to the specified layer.
 * Uses value guards to detect conflicts with upstream changes.
 *
 * @param options - Update options including databaseId, cache, layer, current config, and new input values
 * @returns The write result from the update operation
 * @throws {Error} When a config with the new name already exists
 */
export async function updateRadarrMediaSettings(options: UpdateMediaSettingsOptions) {
  const { databaseId, cache, layer, current, input } = options;
  const db = cache.kb;

  // If renaming, check if new name already exists
  if (input.name !== current.name) {
    const existing = await db
      .selectFrom('radarr_media_settings')
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();

    if (existing) {
      throw new Error(`A radarr media settings config with name "${input.name}" already exists`);
    }
  }

  const setValues: Record<string, unknown> = {};
  if (current.name !== input.name) setValues.name = input.name;
  if (current.propers_repacks !== input.propersRepacks) {
    setValues.propers_repacks = input.propersRepacks;
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    setValues.enable_media_info = input.enableMediaInfo ? 1 : 0;
  }

  let updateQuery = db.updateTable('radarr_media_settings').set(setValues).where('name', '=', current.name);

  if (current.propers_repacks !== input.propersRepacks) {
    updateQuery = updateQuery.where('propers_repacks', '=', current.propers_repacks);
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    updateQuery = updateQuery.where('enable_media_info', '=', current.enable_media_info ? 1 : 0);
  }

  if (Object.keys(setValues).length === 0) {
    return { success: true };
  }

  const updateQueryCompiled = updateQuery.compile();

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (current.name !== input.name) changes.name = { from: current.name, to: input.name };
  if (current.propers_repacks !== input.propersRepacks) {
    changes.propersRepacks = { from: current.propers_repacks, to: input.propersRepacks };
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    changes.enableMediaInfo = { from: current.enable_media_info, to: input.enableMediaInfo };
  }

  const changedFields = Object.keys(changes);
  const desiredState: Record<string, unknown> = {};
  if (changes.name) desiredState.name = { from: current.name, to: input.name };
  if (changes.propersRepacks) {
    desiredState.propers_repacks = {
      from: current.propers_repacks,
      to: input.propersRepacks,
    };
  }
  if (changes.enableMediaInfo) {
    desiredState.enable_media_info = {
      from: current.enable_media_info,
      to: input.enableMediaInfo,
    };
  }

  return writeOperation({
    databaseId,
    layer,
    description: `update-radarr-media-settings-${input.name}`,
    queries: [updateQueryCompiled],
    desiredState,
    metadata: {
      operation: 'update',
      entity: 'radarr_media_settings',
      name: input.name,
      ...(current.name !== input.name && { previousName: current.name }),
      stableKey: { key: 'radarr_media_settings_name', value: current.name },
      changedFields,
      summary: 'Update Radarr media settings',
      title: `Update Radarr media settings "${input.name}"`,
    },
  });
}

export interface UpdateSonarrMediaSettingsOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: SonarrMediaSettingsRow;
  input: UpdateMediaSettingsInput;
}

export interface UpdateLidarrMediaSettingsOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: LidarrMediaSettingsRow;
  input: UpdateMediaSettingsInput;
}

/**
 * Update a Sonarr media settings config by writing an operation to the specified layer.
 * Uses value guards to detect conflicts with upstream changes.
 *
 * @param options - Update options including databaseId, cache, layer, current config, and new input values
 * @returns The write result from the update operation
 * @throws {Error} When a config with the new name already exists
 */
export async function updateSonarrMediaSettings(options: UpdateSonarrMediaSettingsOptions) {
  const { databaseId, cache, layer, current, input } = options;
  const db = cache.kb;

  // If renaming, check if new name already exists
  if (input.name !== current.name) {
    const existing = await db
      .selectFrom('sonarr_media_settings')
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();

    if (existing) {
      throw new Error(`A sonarr media settings config with name "${input.name}" already exists`);
    }
  }

  const setValues: Record<string, unknown> = {};
  if (current.name !== input.name) setValues.name = input.name;
  if (current.propers_repacks !== input.propersRepacks) {
    setValues.propers_repacks = input.propersRepacks;
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    setValues.enable_media_info = input.enableMediaInfo ? 1 : 0;
  }

  let updateQuery = db.updateTable('sonarr_media_settings').set(setValues).where('name', '=', current.name);

  if (current.propers_repacks !== input.propersRepacks) {
    updateQuery = updateQuery.where('propers_repacks', '=', current.propers_repacks);
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    updateQuery = updateQuery.where('enable_media_info', '=', current.enable_media_info ? 1 : 0);
  }

  if (Object.keys(setValues).length === 0) {
    return { success: true };
  }

  const updateQueryCompiled = updateQuery.compile();

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (current.name !== input.name) changes.name = { from: current.name, to: input.name };
  if (current.propers_repacks !== input.propersRepacks) {
    changes.propersRepacks = { from: current.propers_repacks, to: input.propersRepacks };
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    changes.enableMediaInfo = { from: current.enable_media_info, to: input.enableMediaInfo };
  }

  const changedFields = Object.keys(changes);
  const desiredState: Record<string, unknown> = {};
  if (changes.name) desiredState.name = { from: current.name, to: input.name };
  if (changes.propersRepacks) {
    desiredState.propers_repacks = {
      from: current.propers_repacks,
      to: input.propersRepacks,
    };
  }
  if (changes.enableMediaInfo) {
    desiredState.enable_media_info = {
      from: current.enable_media_info,
      to: input.enableMediaInfo,
    };
  }

  return writeOperation({
    databaseId,
    layer,
    description: `update-sonarr-media-settings-${input.name}`,
    queries: [updateQueryCompiled],
    desiredState,
    metadata: {
      operation: 'update',
      entity: 'sonarr_media_settings',
      name: input.name,
      ...(current.name !== input.name && { previousName: current.name }),
      stableKey: { key: 'sonarr_media_settings_name', value: current.name },
      changedFields,
      summary: 'Update Sonarr media settings',
      title: `Update Sonarr media settings "${input.name}"`,
    },
  });
}

/**
 * Update a Lidarr media settings config by writing an operation to the specified layer.
 * Uses value guards to detect conflicts with upstream changes.
 *
 * @param options - Update options including databaseId, cache, layer, current config, and new input values
 * @returns The write result from the update operation
 * @throws {Error} When a config with the new name already exists
 */
export async function updateLidarrMediaSettings(options: UpdateLidarrMediaSettingsOptions) {
  const { databaseId, cache, layer, current, input } = options;
  const db = cache.kb;

  if (input.name !== current.name) {
    const existing = await db
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();

    if (existing) {
      throw new Error(`A lidarr media settings config with name "${input.name}" already exists`);
    }
  }

  const setValues: Record<string, unknown> = {};
  if (current.name !== input.name) setValues.name = input.name;
  if (current.propers_repacks !== input.propersRepacks) {
    setValues.propers_repacks = input.propersRepacks;
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    setValues.enable_media_info = input.enableMediaInfo ? 1 : 0;
  }

  let updateQuery = db
    .updateTable('lidarr_media_settings' as keyof PCDDatabase)
    .set(setValues)
    .where('name', '=', current.name);

  if (current.propers_repacks !== input.propersRepacks) {
    updateQuery = updateQuery.where('propers_repacks', '=', current.propers_repacks);
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    updateQuery = updateQuery.where('enable_media_info', '=', current.enable_media_info ? 1 : 0);
  }

  if (Object.keys(setValues).length === 0) {
    return { success: true };
  }

  const updateQueryCompiled = updateQuery.compile();

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (current.name !== input.name) changes.name = { from: current.name, to: input.name };
  if (current.propers_repacks !== input.propersRepacks) {
    changes.propersRepacks = { from: current.propers_repacks, to: input.propersRepacks };
  }
  if (current.enable_media_info !== input.enableMediaInfo) {
    changes.enableMediaInfo = { from: current.enable_media_info, to: input.enableMediaInfo };
  }

  const changedFields = Object.keys(changes);
  const desiredState: Record<string, unknown> = {};
  if (changes.name) desiredState.name = { from: current.name, to: input.name };
  if (changes.propersRepacks) {
    desiredState.propers_repacks = {
      from: current.propers_repacks,
      to: input.propersRepacks,
    };
  }
  if (changes.enableMediaInfo) {
    desiredState.enable_media_info = {
      from: current.enable_media_info,
      to: input.enableMediaInfo,
    };
  }

  return writeOperation({
    databaseId,
    layer,
    description: `update-lidarr-media-settings-${input.name}`,
    queries: [updateQueryCompiled],
    desiredState,
    metadata: {
      operation: 'update',
      entity: 'lidarr_media_settings',
      name: input.name,
      ...(current.name !== input.name && { previousName: current.name }),
      stableKey: { key: 'lidarr_media_settings_name', value: current.name },
      changedFields,
      summary: 'Update Lidarr media settings',
      title: `Update Lidarr media settings "${input.name}"`,
    },
  });
}
