import { getCache } from '$pcd/index.ts';
import type { PCDCache, WriteResult } from '$pcd/index.ts';
import type { LidarrMediaSettingsRow, RadarrMediaSettingsRow, SonarrMediaSettingsRow } from '$shared/pcd/display.ts';
import { getLidarrByName, getRadarrByName, getSonarrByName } from './read.ts';
import { updateLidarrMediaSettings, updateRadarrMediaSettings, updateSonarrMediaSettings } from './update.ts';
import type { StoredDesiredState, StoredOpMetadata } from '$pcd/conflicts/overrideUtils.ts';
import { followRenameChain, getDesiredTo, valuesEqual } from '$pcd/conflicts/overrideUtils.ts';

type SettingsTable = 'radarr_media_settings' | 'sonarr_media_settings' | 'lidarr_media_settings';

async function resolveName(
  cache: PCDCache,
  databaseId: number,
  table: SettingsTable,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<string | null> {
  const candidates = [
    metadata?.stable_key?.value,
    metadata?.name,
    getDesiredTo<string>(desiredState?.name),
    typeof desiredState?.name === 'string' ? desiredState.name : null,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (candidates.length === 0) return null;

  for (const name of candidates) {
    const row = await cache.kb.selectFrom(table).select('name').where('name', '=', name).executeTakeFirst();
    if (row) return row.name ?? null;
  }

  const entityType: SettingsTable =
    table === 'radarr_media_settings'
      ? 'radarr_media_settings'
      : table === 'sonarr_media_settings'
        ? 'sonarr_media_settings'
        : 'lidarr_media_settings';
  const resolved = followRenameChain(databaseId, entityType, candidates[0]);

  if (resolved !== candidates[0]) {
    const row = await cache.kb.selectFrom(table).select('name').where('name', '=', resolved).executeTakeFirst();
    if (row) return row.name ?? null;
  }

  return null;
}

function resolveString(value: unknown, fallback: string): string {
  const resolved = getDesiredTo<string>(value);
  if (typeof resolved === 'string') return resolved;
  if (typeof value === 'string') return value;
  return fallback;
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
  const resolved = getDesiredTo<boolean>(value);
  if (typeof resolved === 'boolean') return resolved;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return fallback;
}

async function overrideRadarr(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  if (!desiredState) {
    return { success: false, error: 'Missing desired state for radarr media settings override' };
  }

  const cache = getCache(databaseId);
  if (!cache) {
    return { success: false, error: 'Cache not available' };
  }

  const name = await resolveName(cache, databaseId, 'radarr_media_settings', metadata, desiredState);
  if (!name) {
    return { success: false, error: 'Radarr media settings not found for override' };
  }

  const current = await getRadarrByName(cache, name);
  if (!current) {
    return { success: false, error: 'Radarr media settings not found for override' };
  }

  const desiredName = resolveString(desiredState.name, current.name);
  const desiredPropersRepacks = resolveString(
    desiredState.propers_repacks,
    current.propers_repacks
  ) as RadarrMediaSettingsRow['propers_repacks'];
  const desiredEnableMediaInfo = resolveBoolean(desiredState.enable_media_info, current.enable_media_info);

  const matches =
    current.name === desiredName &&
    current.propers_repacks === desiredPropersRepacks &&
    valuesEqual(current.enable_media_info, desiredEnableMediaInfo);

  if (matches) {
    return { success: true };
  }

  return updateRadarrMediaSettings({
    databaseId,
    cache,
    layer: 'user',
    current,
    input: {
      name: desiredName,
      propersRepacks: desiredPropersRepacks,
      enableMediaInfo: desiredEnableMediaInfo,
    },
  });
}

async function overrideSonarr(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  if (!desiredState) {
    return { success: false, error: 'Missing desired state for sonarr media settings override' };
  }

  const cache = getCache(databaseId);
  if (!cache) {
    return { success: false, error: 'Cache not available' };
  }

  const name = await resolveName(cache, databaseId, 'sonarr_media_settings', metadata, desiredState);
  if (!name) {
    return { success: false, error: 'Sonarr media settings not found for override' };
  }

  const current = await getSonarrByName(cache, name);
  if (!current) {
    return { success: false, error: 'Sonarr media settings not found for override' };
  }

  const desiredName = resolveString(desiredState.name, current.name);
  const desiredPropersRepacks = resolveString(
    desiredState.propers_repacks,
    current.propers_repacks
  ) as SonarrMediaSettingsRow['propers_repacks'];
  const desiredEnableMediaInfo = resolveBoolean(desiredState.enable_media_info, current.enable_media_info);

  const matches =
    current.name === desiredName &&
    current.propers_repacks === desiredPropersRepacks &&
    valuesEqual(current.enable_media_info, desiredEnableMediaInfo);

  if (matches) {
    return { success: true };
  }

  return updateSonarrMediaSettings({
    databaseId,
    cache,
    layer: 'user',
    current,
    input: {
      name: desiredName,
      propersRepacks: desiredPropersRepacks,
      enableMediaInfo: desiredEnableMediaInfo,
    },
  });
}

async function overrideLidarr(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  if (!desiredState) {
    return { success: false, error: 'Missing desired state for lidarr media settings override' };
  }

  const cache = getCache(databaseId);
  if (!cache) {
    return { success: false, error: 'Cache not available' };
  }

  const name = await resolveName(cache, databaseId, 'lidarr_media_settings', metadata, desiredState);
  if (!name) {
    return { success: false, error: 'Lidarr media settings not found for override' };
  }

  const current = await getLidarrByName(cache, name);
  if (!current) {
    return { success: false, error: 'Lidarr media settings not found for override' };
  }

  const desiredName = resolveString(desiredState.name, current.name);
  const desiredPropersRepacks = resolveString(
    desiredState.propers_repacks,
    current.propers_repacks
  ) as LidarrMediaSettingsRow['propers_repacks'];
  const desiredEnableMediaInfo = resolveBoolean(desiredState.enable_media_info, current.enable_media_info);

  const matches =
    current.name === desiredName &&
    current.propers_repacks === desiredPropersRepacks &&
    valuesEqual(current.enable_media_info, desiredEnableMediaInfo);

  if (matches) {
    return { success: true };
  }

  return updateLidarrMediaSettings({
    databaseId,
    cache,
    layer: 'user',
    current,
    input: {
      name: desiredName,
      propersRepacks: desiredPropersRepacks,
      enableMediaInfo: desiredEnableMediaInfo,
    },
  });
}

/**
 * Override a media settings create or update operation, dispatching to the correct Arr-specific handler.
 *
 * @param databaseId - The PCD database ID
 * @param metadata - Stored op metadata indicating the target entity type (radarr/sonarr/lidarr)
 * @param desiredState - The desired state to apply
 * @returns The write result from the Arr-specific override handler
 */
export function overrideCreate(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  switch (metadata?.entity) {
    case 'radarr_media_settings':
      return overrideRadarr(databaseId, metadata, desiredState);
    case 'sonarr_media_settings':
      return overrideSonarr(databaseId, metadata, desiredState);
    case 'lidarr_media_settings':
      return overrideLidarr(databaseId, metadata, desiredState);
    default:
      return Promise.resolve({
        success: false,
        error: `Unsupported media settings override entity: ${metadata?.entity ?? 'unknown'}`,
      });
  }
}

/**
 * Override a media settings update operation by delegating to overrideCreate.
 *
 * @param databaseId - The PCD database ID
 * @param metadata - Stored op metadata indicating the target entity type
 * @param desiredState - The desired state to apply
 * @returns The write result from the override handler
 */
export function overrideUpdate(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  return overrideCreate(databaseId, metadata, desiredState);
}
