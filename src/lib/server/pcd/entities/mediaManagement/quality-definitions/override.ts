import { getCache } from '$pcd/index.ts';
import type { PCDCache, WriteResult } from '$pcd/index.ts';
import type { QualityDefinitionEntry } from '$shared/pcd/display.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { getLidarrByName, getRadarrByName, getSonarrByName } from './read.ts';
import {
  updateLidarrQualityDefinitions,
  updateRadarrQualityDefinitions,
  updateSonarrQualityDefinitions,
} from './update.ts';
import type { StoredDesiredState, StoredOpMetadata } from '$pcd/conflicts/overrideUtils.ts';
import { followRenameChain, getDesiredTo } from '$pcd/conflicts/overrideUtils.ts';

type QdTable = 'radarr_quality_definitions' | 'sonarr_quality_definitions' | 'lidarr_quality_definitions';

async function resolveName(
  cache: PCDCache,
  databaseId: number,
  table: QdTable,
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

  const tableName = table as keyof PCDDatabase;

  for (const name of candidates) {
    const row = await cache.kb.selectFrom(tableName).select('name').where('name', '=', name).executeTakeFirst();
    if (row) return row.name ?? null;
  }

  const entityType: QdTable =
    table === 'radarr_quality_definitions'
      ? 'radarr_quality_definitions'
      : table === 'sonarr_quality_definitions'
        ? 'sonarr_quality_definitions'
        : 'lidarr_quality_definitions';
  const resolved = followRenameChain(databaseId, entityType, candidates[0]);

  if (resolved !== candidates[0]) {
    const row = await cache.kb.selectFrom(tableName).select('name').where('name', '=', resolved).executeTakeFirst();
    if (row) return row.name ?? null;
  }

  return null;
}

function resolveEntries(desiredState: StoredDesiredState): QualityDefinitionEntry[] | null {
  const field = desiredState.entries;
  if (!field) return null;

  if (typeof field === 'object' && 'to' in (field as Record<string, unknown>)) {
    const to = (field as { to: unknown }).to;
    if (Array.isArray(to)) return to as QualityDefinitionEntry[];
  }

  if (Array.isArray(field)) return field as QualityDefinitionEntry[];

  return null;
}

function resolveDesiredName(desiredState: StoredDesiredState, fallback: string): string {
  const resolved = getDesiredTo<string>(desiredState.name);
  if (typeof resolved === 'string') return resolved;
  if (typeof desiredState.name === 'string') return desiredState.name;
  return fallback;
}

function entriesEqual(a: QualityDefinitionEntry[], b: QualityDefinitionEntry[]): boolean {
  const normalize = (entries: QualityDefinitionEntry[]) =>
    entries
      .map((entry) => ({
        quality_name: entry.quality_name,
        min_size: entry.min_size,
        max_size: entry.max_size,
        preferred_size: entry.preferred_size,
      }))
      .sort((x, y) => x.quality_name.localeCompare(y.quality_name));

  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

async function overrideRadarr(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  if (!desiredState) {
    return { success: false, error: 'Missing desired state for radarr quality definitions override' };
  }

  const cache = getCache(databaseId);
  if (!cache) {
    return { success: false, error: 'Cache not available' };
  }

  const name = await resolveName(cache, databaseId, 'radarr_quality_definitions', metadata, desiredState);
  if (!name) {
    return { success: false, error: 'Radarr quality definitions not found for override' };
  }

  const current = await getRadarrByName(cache, name);
  if (!current) {
    return { success: false, error: 'Radarr quality definitions not found for override' };
  }

  const desiredName = resolveDesiredName(desiredState, current.name);
  const desiredEntries = resolveEntries(desiredState) ?? current.entries;

  if (current.name === desiredName && entriesEqual(current.entries, desiredEntries)) {
    return { success: true };
  }

  return updateRadarrQualityDefinitions({
    databaseId,
    cache,
    layer: 'user',
    current,
    input: {
      name: desiredName,
      entries: desiredEntries,
    },
  });
}

async function overrideSonarr(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  if (!desiredState) {
    return { success: false, error: 'Missing desired state for sonarr quality definitions override' };
  }

  const cache = getCache(databaseId);
  if (!cache) {
    return { success: false, error: 'Cache not available' };
  }

  const name = await resolveName(cache, databaseId, 'sonarr_quality_definitions', metadata, desiredState);
  if (!name) {
    return { success: false, error: 'Sonarr quality definitions not found for override' };
  }

  const current = await getSonarrByName(cache, name);
  if (!current) {
    return { success: false, error: 'Sonarr quality definitions not found for override' };
  }

  const desiredName = resolveDesiredName(desiredState, current.name);
  const desiredEntries = resolveEntries(desiredState) ?? current.entries;

  if (current.name === desiredName && entriesEqual(current.entries, desiredEntries)) {
    return { success: true };
  }

  return updateSonarrQualityDefinitions({
    databaseId,
    cache,
    layer: 'user',
    current,
    input: {
      name: desiredName,
      entries: desiredEntries,
    },
  });
}

async function overrideLidarr(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  if (!desiredState) {
    return { success: false, error: 'Missing desired state for lidarr quality definitions override' };
  }

  const cache = getCache(databaseId);
  if (!cache) {
    return { success: false, error: 'Cache not available' };
  }

  const name = await resolveName(cache, databaseId, 'lidarr_quality_definitions', metadata, desiredState);
  if (!name) {
    return { success: false, error: 'Lidarr quality definitions not found for override' };
  }

  const current = await getLidarrByName(cache, name);
  if (!current) {
    return { success: false, error: 'Lidarr quality definitions not found for override' };
  }

  const desiredName = resolveDesiredName(desiredState, current.name);
  const desiredEntries = resolveEntries(desiredState) ?? current.entries;

  if (current.name === desiredName && entriesEqual(current.entries, desiredEntries)) {
    return { success: true };
  }

  return updateLidarrQualityDefinitions({
    databaseId,
    cache,
    layer: 'user',
    current,
    input: {
      name: desiredName,
      entries: desiredEntries,
    },
  });
}

export function overrideCreate(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  switch (metadata?.entity) {
    case 'radarr_quality_definitions':
      return overrideRadarr(databaseId, metadata, desiredState);
    case 'sonarr_quality_definitions':
      return overrideSonarr(databaseId, metadata, desiredState);
    case 'lidarr_quality_definitions':
      return overrideLidarr(databaseId, metadata, desiredState);
    default:
      return Promise.resolve({
        success: false,
        error: `Unsupported quality definitions override entity: ${metadata?.entity ?? 'unknown'}`,
      });
  }
}

export function overrideUpdate(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null
): Promise<WriteResult> {
  return overrideCreate(databaseId, metadata, desiredState);
}
