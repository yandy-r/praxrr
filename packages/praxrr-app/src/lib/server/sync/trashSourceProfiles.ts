/**
 * Shared TRaSH Guide quality profile source resolution.
 *
 * The quality profile syncer and Arr cleanup both need to know which TRaSH profiles
 * resolve for a source and which namespace suffix each source gets. Keeping both
 * steps here guarantees cleanup computes exactly the suffixes sync writes.
 */

import type { TrashGuideSyncQualityProfileSourceHydration } from '$db/queries/trashGuideSync.ts';
import { type TrashGuideEntityCache, trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { arrTrashNamespaceQueries } from '$db/queries/arrTrashNamespaces.ts';
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

/** Planned persisted TRaSH namespace for one source. */
export interface TrashNamespaceAssignment {
  sourceId: number;
  index: number;
}

/**
 * Result of planning one pass. `blockedSourceIds` is non-empty only when TRaSH writes must be
 * withheld for this pass; `plan` is then empty.
 */
export interface TrashNamespacePlan {
  plan: Map<number, TrashNamespaceAssignment>;
  blockedSourceIds: number[];
}

/**
 * Plan stable TRaSH namespace indexes for one pass over an instance's sources (YAN-443).
 *
 * `resolutions` must cover every hydrated source with selections, in hydration order. Only
 * sources with at least one resolved profile get a namespace. Indexes are persisted per
 * (instance, source) and never shift when other sources come and go. New sources get
 * `MAX + 1, MAX + 2, …` in hydration order: `allocate` (real sync) persists them via
 * `getOrCreate`; `predict` (preview, drift, history, MCP) only computes them, read-only.
 *
 * Upgrade guard: while the instance has no rows yet, its Arr may still hold items written under
 * the old positional scheme. Numbering then reproduces pre-upgrade indexes only if every source
 * resolves, so when some source is unresolved and `hasPriorTrashSync()` reports such items, the
 * pass is blocked (no TRaSH batch is written) instead of shifting later sources onto the
 * unresolved source's items. Without prior items nothing can collide, so allocation proceeds.
 */
export async function planTrashNamespaces(
  instanceId: number,
  resolutions: readonly TrashSourceResolution[],
  mode: 'allocate' | 'predict',
  hasPriorTrashSync: () => Promise<boolean>
): Promise<TrashNamespacePlan> {
  const plan = new Map<number, TrashNamespaceAssignment>();
  const maxIndex = arrTrashNamespaceQueries.getMaxIndex(instanceId);
  const unresolvedSourceIds = resolutions.flatMap((resolution) =>
    resolution.status !== 'resolved' && resolution.source ? [resolution.source.id] : []
  );
  const hasUnresolved = resolutions.some((resolution) => resolution.status !== 'resolved');

  if (maxIndex === 0 && hasUnresolved && (await hasPriorTrashSync())) {
    await logger.warn('TRaSH quality profile sync blocked until every TRaSH source resolves', {
      source: 'TrashNamespaces',
      meta: { instanceId, mode, unresolvedSourceIds },
    });
    return { plan, blockedSourceIds: unresolvedSourceIds };
  }

  let nextPredicted = maxIndex + 1;
  for (const resolution of resolutions) {
    if (resolution.status !== 'resolved' || resolution.resolvedProfileNames.length === 0) continue;
    const sourceId = resolution.source.id;
    const index =
      arrTrashNamespaceQueries.get(instanceId, sourceId) ??
      (mode === 'allocate' ? arrTrashNamespaceQueries.getOrCreate(instanceId, sourceId) : nextPredicted++);
    plan.set(sourceId, { sourceId, index });
  }
  return { plan, blockedSourceIds: [] };
}

/**
 * Persist a planned assignment at write time for a reviewed (prepared) sync and fail fast when
 * the persisted state no longer matches the reviewed suffix. Call in hydration (batch) order.
 */
export function confirmTrashNamespace(instanceId: number, assignment: TrashNamespaceAssignment): void {
  const current = arrTrashNamespaceQueries.getOrCreate(instanceId, assignment.sourceId);
  if (current !== assignment.index) {
    throw new Error(
      `Reviewed TRaSH namespace for source ${assignment.sourceId} is stale ` +
        `(reviewed index ${assignment.index}, current ${current}); preview again before syncing`
    );
  }
}
