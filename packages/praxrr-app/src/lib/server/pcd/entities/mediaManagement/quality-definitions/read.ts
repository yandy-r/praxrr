/**
 * Quality definitions read operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import type { ArrType } from '$shared/pcd/types.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { QUALITIES } from '$sync/mappings.ts';
import type {
  QualityDefinitionEntry,
  QualityDefinitionListItem,
  QualityDefinitionsConfig,
} from '$shared/pcd/display.ts';

type QualityDefinitionConfigRow = {
  name: string;
  quality_name: string;
  updated_at: string | null;
};

type QualityDefinitionEntryRow = {
  quality_name: string;
  min_size: number;
  max_size: number;
  preferred_size: number;
};

type ConcreteArrType = Exclude<ArrType, 'all'>;

type QualityApiName = string;

const QUALITY_API_NAMES_BY_ARR_TYPE: Record<ConcreteArrType, ReadonlySet<QualityApiName>> = {
  radarr: new Set(Object.keys(QUALITIES.radarr)),
  sonarr: new Set(Object.keys(QUALITIES.sonarr)),
  lidarr: new Set(Object.keys(QUALITIES.lidarr)),
};

type QualityDefinitionsStorageTable = 'radarr' | 'sonarr' | 'lidarr';

const QUALITY_DEFINITIONS_STORAGE: Record<ConcreteArrType, QualityDefinitionsStorageTable> = {
  radarr: 'radarr',
  sonarr: 'sonarr',
  lidarr: 'lidarr',
};

const QUALITY_LOOKUP_MISSING_WARNING_REASON =
  'Quality entries are filtered out when quality_api_mappings reference unknown API quality names';

const WARNED_UNMAPPED_QUALITY_ROWS_BY_CACHE = new WeakMap<PCDCache, Set<string>>();
const WARNED_UNMAPPED_QUALITY_ROWS_MAX = 2048;

function getOrCreateWarnedSet(cache: PCDCache): Set<string> {
  let set = WARNED_UNMAPPED_QUALITY_ROWS_BY_CACHE.get(cache);
  if (!set) {
    set = new Set<string>();
    WARNED_UNMAPPED_QUALITY_ROWS_BY_CACHE.set(cache, set);
  }
  return set;
}
const MAX_LOGGED_SKIPPED_QUALITY_NAMES = 10;

/**
 * Assert arr type is concrete for quality mapping lookups.
 */
function assertConcreteArrType(arrType: ArrType): asserts arrType is ConcreteArrType {
  if (arrType === 'all') {
    throw new Error('Quality API mappings are not defined for arrType=all');
  }
}

/**
 * Validate that an API name exists in the mapping constants for the arr type.
 */
export function isKnownQualityApiName(arrType: ConcreteArrType, apiName: string): boolean {
  return QUALITY_API_NAMES_BY_ARR_TYPE[arrType].has(apiName);
}

/**
 * Resolve quality-definition storage table segment for a concrete arr type.
 */
export function getQualityDefinitionsStorage(arrType: ArrType): QualityDefinitionsStorageTable {
  assertConcreteArrType(arrType);
  return QUALITY_DEFINITIONS_STORAGE[arrType];
}

export interface QualityApiMappingLookup {
  qualityToApiName: Map<string, string>;
  availableQualityNames: string[];
}

/**
 * Get quality API mappings for an arr type.
 *
 * Returns
 * - qualityToApiName: normalized quality_name -> api_name map
 * - availableQualityNames: original quality_name values that have known API names
 *
 * Unknown API mappings are skipped with warning metadata so lookup and sync behavior
 * stays deterministic when mapping rows are missing or misconfigured.
 */
export async function getQualityApiMappings(cache: PCDCache, arrType: ArrType): Promise<QualityApiMappingLookup> {
  assertConcreteArrType(arrType);

  const rows = await cache.kb
    .selectFrom('quality_api_mappings')
    .where('arr_type', '=', arrType)
    .select(['quality_name', 'api_name'])
    .execute();

  const qualityToApiName = new Map<string, string>();
  const normalizedToOriginalQualityName = new Map<string, string>();
  const skippedMappings: Array<{ qualityName: string; apiName: string }> = [];

  for (const row of rows) {
    const qualityName = row.quality_name?.trim();
    const apiName = row.api_name?.trim();

    if (!qualityName || !apiName) {
      skippedMappings.push({
        qualityName: row.quality_name,
        apiName: row.api_name,
      });
      continue;
    }

    if (!isKnownQualityApiName(arrType, apiName)) {
      skippedMappings.push({ qualityName, apiName });
      continue;
    }

    const normalizedQualityName = qualityName.toLowerCase();
    qualityToApiName.set(normalizedQualityName, apiName);
    normalizedToOriginalQualityName.set(normalizedQualityName, qualityName);
  }

  if (skippedMappings.length > 0) {
    await logger.warn('Skipping quality API mappings with unsupported or incomplete API entries', {
      source: 'PCD:QualityDefinitions',
      meta: {
        arrType,
        reason: QUALITY_LOOKUP_MISSING_WARNING_REASON,
        skippedMappings,
      },
    });
  }

  return {
    qualityToApiName,
    availableQualityNames: [...normalizedToOriginalQualityName.values()].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Get available qualities for an arr type from quality_api_mappings
 * Returns quality names that can be used for that arr type.
 */
export async function getAvailableQualities(cache: PCDCache, arrType: ArrType): Promise<string[]> {
  const { availableQualityNames } = await getQualityApiMappings(cache, arrType);

  if (availableQualityNames.length === 0) {
    await logger.warn('No quality API mappings available for quality definitions lookup', {
      source: 'PCD:QualityDefinitions',
      meta: {
        arrType,
        reason: QUALITY_LOOKUP_MISSING_WARNING_REASON,
      },
    });
  }

  return availableQualityNames;
}

function mapRowsToEntries(rows: QualityDefinitionEntryRow[]): QualityDefinitionEntry[] {
  return rows.map((row) => ({
    quality_name: row.quality_name,
    min_size: row.min_size,
    max_size: row.max_size,
    preferred_size: row.preferred_size,
  }));
}

const MAX_SKIPPED_QUALITY_NAMES_IN_KEY = 50;

function hashString(value: string): string {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    const chr = value.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32-bit integer
  }

  return hash.toString(16);
}

function getUnmappedQualityWarningKey(
  arrType: ConcreteArrType,
  configName: string,
  skippedQualityNames: string[]
): string {
  const keyQualityNames = skippedQualityNames.slice(0, MAX_SKIPPED_QUALITY_NAMES_IN_KEY);
  const joinedNames = keyQualityNames.join('\u0001');
  const namesHash = hashString(joinedNames);

  return `${arrType}:${configName}:${namesHash}`;
}
async function warnUnmappedQualityDefinitionRows(
  cache: PCDCache,
  message: string,
  arrType: ConcreteArrType,
  configName: string,
  skippedQualityNames: Set<string>
): Promise<void> {
  if (skippedQualityNames.size === 0) {
    return;
  }

  const warnedSet = getOrCreateWarnedSet(cache);
  const sortedSkippedQualityNames = [...skippedQualityNames].sort();
  const warningKey = getUnmappedQualityWarningKey(arrType, configName, sortedSkippedQualityNames);
  if (warnedSet.has(warningKey)) {
    return;
  }

  if (warnedSet.size >= WARNED_UNMAPPED_QUALITY_ROWS_MAX) {
    warnedSet.clear();
  }
  warnedSet.add(warningKey);

  const visibleSkippedQualityNames = sortedSkippedQualityNames.slice(0, MAX_LOGGED_SKIPPED_QUALITY_NAMES);

  await logger.warn(message, {
    source: 'PCD:QualityDefinitions',
    meta: {
      arrType,
      configName,
      skippedQualityNames: visibleSkippedQualityNames,
      skippedQualityNamesHiddenCount: sortedSkippedQualityNames.length - visibleSkippedQualityNames.length,
      reason: QUALITY_LOOKUP_MISSING_WARNING_REASON,
    },
  });
}

async function pushListRows(
  cache: PCDCache,
  rows: QualityDefinitionConfigRow[],
  arrType: ConcreteArrType,
  apiLookup: Map<string, string>,
  result: QualityDefinitionListItem[]
): Promise<void> {
  const configs = new Map<
    string,
    {
      quality_count: number;
      updated_at: string;
      skippedQualityNames: Set<string>;
    }
  >();

  for (const row of rows) {
    const current = configs.get(row.name) ?? {
      quality_count: 0,
      updated_at: row.updated_at ?? '',
      skippedQualityNames: new Set<string>(),
    };

    const updatedAt = row.updated_at ?? '';
    if (updatedAt > current.updated_at) {
      current.updated_at = updatedAt;
    }

    if (apiLookup.has(row.quality_name.toLowerCase())) {
      current.quality_count += 1;
    } else {
      current.skippedQualityNames.add(row.quality_name);
    }

    configs.set(row.name, current);
  }

  for (const [name, data] of configs) {
    await warnUnmappedQualityDefinitionRows(
      cache,
      'Skipping unmapped quality definition rows in quality definitions list',
      arrType,
      name,
      data.skippedQualityNames
    );

    result.push({
      name,
      arr_type: arrType,
      quality_count: data.quality_count,
      updated_at: data.updated_at,
    });
  }
}

/**
 * List all quality definitions configs
 * Returns distinct config names with quality counts for mapped entries.
 */
export async function list(cache: PCDCache): Promise<QualityDefinitionListItem[]> {
  const [radarrRows, sonarrRows, lidarrRowsRaw, radarrMappings, sonarrMappings, lidarrMappings] = await Promise.all([
    cache.kb.selectFrom('radarr_quality_definitions').select(['name', 'quality_name', 'updated_at']).execute(),
    cache.kb.selectFrom('sonarr_quality_definitions').select(['name', 'quality_name', 'updated_at']).execute(),
    cache.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .select(['name', 'quality_name', 'updated_at'])
      .execute(),
    getQualityApiMappings(cache, 'radarr'),
    getQualityApiMappings(cache, 'sonarr'),
    getQualityApiMappings(cache, 'lidarr'),
  ]);
  const lidarrRows = lidarrRowsRaw as QualityDefinitionConfigRow[];

  const result: QualityDefinitionListItem[] = [];

  const arrTypePriority = new Map<ConcreteArrType, number>([
    ['radarr', 1],
    ['lidarr', 2],
    ['sonarr', 3],
  ]);

  await pushListRows(cache, radarrRows, 'radarr', radarrMappings.qualityToApiName, result);
  await pushListRows(cache, lidarrRows, 'lidarr', lidarrMappings.qualityToApiName, result);
  await pushListRows(cache, sonarrRows, 'sonarr', sonarrMappings.qualityToApiName, result);

  // Sort by updated_at desc
  result.sort((a, b) => {
    const timestampOrder = b.updated_at.localeCompare(a.updated_at);
    if (timestampOrder !== 0) {
      return timestampOrder;
    }

    const aPriority = arrTypePriority.get(a.arr_type) ?? 99;
    const bPriority = arrTypePriority.get(b.arr_type) ?? 99;
    return aPriority - bPriority;
  });

  return result;
}

/**
 * Get a Radarr quality definitions config by name
 */
export async function getRadarrByName(cache: PCDCache, name: string): Promise<QualityDefinitionsConfig | null> {
  const rows = await cache.kb
    .selectFrom('radarr_quality_definitions')
    .where('name', '=', name)
    .select(['quality_name', 'min_size', 'max_size', 'preferred_size'])
    .execute();

  if (rows.length === 0) {
    return null;
  }

  return {
    name,
    entries: mapRowsToEntries(rows),
  };
}

/**
 * Get a Sonarr quality definitions config by name
 */
export async function getSonarrByName(cache: PCDCache, name: string): Promise<QualityDefinitionsConfig | null> {
  const rows = await cache.kb
    .selectFrom('sonarr_quality_definitions')
    .where('name', '=', name)
    .select(['quality_name', 'min_size', 'max_size', 'preferred_size'])
    .execute();

  if (rows.length === 0) {
    return null;
  }

  return {
    name,
    entries: mapRowsToEntries(rows),
  };
}

/**
 * Get a Lidarr quality definitions config by name.
 * Rows without Lidarr mappings are filtered out with warning metadata.
 */
export async function getLidarrByName(cache: PCDCache, name: string): Promise<QualityDefinitionsConfig | null> {
  const [rowsRaw, { qualityToApiName }] = await Promise.all([
    cache.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .where('name', '=', name)
      .select(['quality_name', 'min_size', 'max_size', 'preferred_size'])
      .execute(),
    getQualityApiMappings(cache, 'lidarr'),
  ]);
  const rows = rowsRaw as QualityDefinitionEntryRow[];

  if (rows.length === 0) {
    return null;
  }

  const mappedRows: QualityDefinitionEntryRow[] = [];
  const skippedQualityNames = new Set<string>();

  for (const row of rows) {
    if (qualityToApiName.has(row.quality_name.toLowerCase())) {
      mappedRows.push(row);
      continue;
    }

    skippedQualityNames.add(row.quality_name);
  }

  await warnUnmappedQualityDefinitionRows(
    cache,
    'Skipping unmapped quality definition rows in Lidarr quality definitions read',
    'lidarr',
    name,
    skippedQualityNames
  );

  return {
    name,
    entries: mapRowsToEntries(mappedRows),
  };
}
