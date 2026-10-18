/**
 * Shared TRaSH Guide quality profile source resolution.
 *
 * The quality profile syncer and Arr cleanup both need to know which TRaSH profiles
 * resolve for a source and which namespace suffix each source gets. Keeping both
 * steps here guarantees cleanup computes exactly the suffixes sync writes.
 */

import type { TrashGuideSyncQualityProfileSourceHydration } from '$db/queries/trashGuideSync.ts';
import { type TrashGuideEntityCache, trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { transformTrashGuideEntities } from '$lib/server/trashguide/transformer.ts';
import type {
  TrashGuideCfGroupEntity,
  TrashGuideCustomFormatEntity,
  TrashGuideNamingEntity,
  TrashGuideParsedEntity,
  TrashGuideParseResult,
  TrashGuideQualityProfileEntity,
  TrashGuideQualitySizeEntity,
} from '$lib/server/trashguide/types.ts';
import type { PortableCustomFormat, PortableQualityProfile } from '$shared/pcd/portable.ts';
import { logger } from '$logger/logger.ts';
import { getTrashGuideNamespaceSuffix } from './namespace.ts';
import type { SyncArrType } from './mappings.ts';

/** Caller-specific log wording; messages are kept byte-identical to each caller's history. */
export interface TrashSourceResolutionLog {
  logSource: string;
  instanceId: number;
  rowParseFailedMessage: string;
  allRowsMalformedMessage: (sourceName: string) => string;
  someRowsMalformedMessage: string;
}

/**
 * Per-source resolution outcome.
 * - `unavailable`: source missing or arr_type mismatch (permanent).
 * - `no_cache`: source has no cached rows (transient; profiles undeterminable).
 * - `transform_failed`: cached rows could not be transformed (transient).
 * - `resolved`: portable maps built; selected names split into resolved/missing.
 */
export type TrashSourceResolution =
  | { status: 'unavailable'; source: TrashGuideSource | null }
  | { status: 'no_cache'; source: TrashGuideSource; cachedRows: TrashGuideEntityCache[] }
  | { status: 'transform_failed'; source: TrashGuideSource; cachedRows: TrashGuideEntityCache[] }
  | {
      status: 'resolved';
      source: TrashGuideSource;
      cachedRows: TrashGuideEntityCache[];
      parsed: TrashGuideParseResult;
      portableProfilesByName: Map<string, PortableQualityProfile>;
      portableFormatsByName: Map<string, PortableCustomFormat>;
      /** Selected profile names found in the source, in selection order. */
      resolvedProfileNames: string[];
      /** Selected profile names absent from the source, in selection order. */
      missingProfileNames: string[];
    };

async function parseCachedRows(
  source: TrashGuideSource,
  cachedRows: TrashGuideEntityCache[],
  log: TrashSourceResolutionLog
): Promise<TrashGuideParsedEntity[]> {
  const parsedEntities: TrashGuideParsedEntity[] = [];
  let malformedRows = 0;
  for (const row of cachedRows) {
    try {
      parsedEntities.push(JSON.parse(row.jsonData) as TrashGuideParsedEntity);
    } catch (error) {
      malformedRows += 1;
      await logger.warn(log.rowParseFailedMessage, {
        source: log.logSource,
        meta: {
          instanceId: log.instanceId,
          sourceId: source.id,
          sourceName: source.name,
          trashId: row.trashId,
          filePath: row.filePath,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const summaryMeta = {
    instanceId: log.instanceId,
    sourceId: source.id,
    sourceName: source.name,
    totalRows: cachedRows.length,
    malformedRows,
  };
  if (parsedEntities.length === 0) {
    const message = log.allRowsMalformedMessage(source.name);
    await logger.error(message, { source: log.logSource, meta: summaryMeta });
    throw new Error(message);
  }
  if (malformedRows > 0) {
    await logger.warn(log.someRowsMalformedMessage, { source: log.logSource, meta: summaryMeta });
  }
  return parsedEntities;
}

function buildParseResult(source: TrashGuideSource, parsedEntities: TrashGuideParsedEntity[]): TrashGuideParseResult {
  return {
    arr_type: source.arr_type,
    status: 'success',
    entities: {
      custom_formats: parsedEntities.filter(
        (entity): entity is TrashGuideCustomFormatEntity => entity.entity_type === 'custom_format'
      ),
      custom_format_groups: parsedEntities.filter(
        (entity): entity is TrashGuideCfGroupEntity => entity.entity_type === 'custom_format_group'
      ),
      quality_profiles: parsedEntities.filter(
        (entity): entity is TrashGuideQualityProfileEntity => entity.entity_type === 'quality_profile'
      ),
      quality_sizes: parsedEntities.filter(
        (entity): entity is TrashGuideQualitySizeEntity => entity.entity_type === 'quality_size'
      ),
      naming: parsedEntities.filter((entity): entity is TrashGuideNamingEntity => entity.entity_type === 'naming'),
    },
    ordered_entities: parsedEntities,
    issues: [],
    parsed_files: parsedEntities.length,
    failed_files: 0,
  };
}

/**
 * Resolve one TRaSH source hydration with selected quality profiles.
 * Throws when every cached row is malformed (same contract as before extraction).
 */
export async function resolveTrashSourceProfiles(
  sourceHydration: TrashGuideSyncQualityProfileSourceHydration,
  arrType: SyncArrType,
  log: TrashSourceResolutionLog
): Promise<TrashSourceResolution> {
  const source = trashGuideSourcesQueries.getById(sourceHydration.sourceId);
  if (!source || source.arr_type !== arrType) {
    return { status: 'unavailable', source: source ?? null };
  }

  const cachedRows = trashGuideEntityCacheQueries.getBySource(source.id);
  if (cachedRows.length === 0) {
    return { status: 'no_cache', source, cachedRows };
  }

  const parsed = buildParseResult(source, await parseCachedRows(source, cachedRows, log));

  let transformed;
  try {
    transformed = transformTrashGuideEntities({ sourceId: source.id, arrType: source.arr_type, parsed });
  } catch (error) {
    await logger.warn(`Skipping TRaSH quality profiles due to transform failure for source "${source.name}"`, {
      source: log.logSource,
      meta: {
        instanceId: log.instanceId,
        sourceId: source.id,
        sourceName: source.name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { status: 'transform_failed', source, cachedRows };
  }

  const portableProfilesByName = new Map<string, PortableQualityProfile>();
  const portableFormatsByName = new Map<string, PortableCustomFormat>();
  for (const operation of transformed.activeOperations) {
    if (operation.portableEntityType === 'quality_profile') {
      portableProfilesByName.set(operation.data.name, operation.data);
    } else if (operation.portableEntityType === 'custom_format') {
      portableFormatsByName.set(operation.data.name, operation.data);
    }
  }

  const resolvedProfileNames: string[] = [];
  const missingProfileNames: string[] = [];
  for (const profileName of sourceHydration.selectedQualityProfiles) {
    (portableProfilesByName.has(profileName) ? resolvedProfileNames : missingProfileNames).push(profileName);
  }

  return {
    status: 'resolved',
    source,
    cachedRows,
    parsed,
    portableProfilesByName,
    portableFormatsByName,
    resolvedProfileNames,
    missingProfileNames,
  };
}

/**
 * Create the TRaSH namespace allocator for one pass over an instance's sources.
 * Call it once per source, in hydration order. A source consumes the next positional
 * index only when at least one selected profile resolved; otherwise it returns null.
 */
export function createTrashNamespaceAllocator(): (resolution: TrashSourceResolution) => string | null {
  let trashNamespaceIndex = 0;
  return (resolution) => {
    if (resolution.status !== 'resolved' || resolution.resolvedProfileNames.length === 0) {
      return null;
    }
    trashNamespaceIndex += 1;
    return getTrashGuideNamespaceSuffix(trashNamespaceIndex);
  };
}
