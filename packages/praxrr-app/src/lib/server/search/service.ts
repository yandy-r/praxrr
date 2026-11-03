/**
 * Cross-entity quick search for the global command palette (`GET /api/v1/search`).
 *
 * Reads only `id`/`name` per entity (never the heavy list loaders, which pull tags, conditions and
 * tests), matches names in JS as literal case-insensitive text, ranks, and caps the result count
 * with a per-type quota so one dense type cannot crowd every other type out of the response.
 * Arr instances are projected to id/name/type so URLs and API keys never cross this boundary.
 */

import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import type { PCDCache } from '$pcd/index.ts';
import { pcdManager } from '$pcd/index.ts';
import { computeCompatibleProfileNames } from '$pcd/entities/qualityProfiles/compatibility.ts';
import { logger } from '$logger/logger.ts';
import { isArrAppType, supportsFeature } from '$shared/arr/capabilities.ts';
import { isTrashGuideSupportedArrType, type TrashGuideEntityType } from '$shared/trashguide/types.ts';
import {
  SEARCH_RESULT_TYPES,
  type SearchResponse,
  type SearchResult,
  type SearchResultType,
} from '$shared/search/types.ts';
import type { SearchParams } from './params.ts';
import { compareNames, rankName, type MatchRank } from './ranking.ts';

type PcdEntityType = Extract<
  SearchResultType,
  'custom_format' | 'quality_profile' | 'regular_expression' | 'delay_profile' | 'metadata_profile'
>;

interface IdName {
  id: number | bigint;
  name: string;
}

interface Match {
  result: SearchResult;
  rank: MatchRank;
  /** Source id (PCD database or TRaSH source) used as a final deterministic tie-breaker. */
  sourceOrder: number;
}

const PCD_ENTITY_TYPES: readonly PcdEntityType[] = [
  'custom_format',
  'quality_profile',
  'regular_expression',
  'delay_profile',
  'metadata_profile',
];

const PCD_LOADERS: Record<PcdEntityType, (cache: PCDCache) => Promise<IdName[]>> = {
  custom_format: (cache) => cache.kb.selectFrom('custom_formats').select(['id', 'name']).execute(),
  quality_profile: (cache) => cache.kb.selectFrom('quality_profiles').select(['id', 'name']).execute(),
  regular_expression: (cache) => cache.kb.selectFrom('regular_expressions').select(['id', 'name']).execute(),
  delay_profile: (cache) => cache.kb.selectFrom('delay_profiles').select(['id', 'name']).execute(),
  metadata_profile: (cache) => cache.kb.selectFrom('lidarr_metadata_profiles').select(['id', 'name']).execute(),
};

function pcdHref(type: PcdEntityType, databaseId: number, row: IdName): string {
  switch (type) {
    case 'custom_format':
      return `/custom-formats/${databaseId}/${row.id}`;
    case 'quality_profile':
      return `/quality-profiles/${databaseId}/${row.id}/general`;
    case 'regular_expression':
      return `/regular-expressions/${databaseId}/${row.id}`;
    case 'delay_profile':
      return `/delay-profiles/${databaseId}/${encodeURIComponent(row.name)}`;
    case 'metadata_profile':
      return `/metadata-profiles/${databaseId}/${encodeURIComponent(row.name)}`;
  }
}

const TRASH_ENTITY_TYPES = {
  custom_format: { segment: 'custom-formats' },
  quality_profile: { segment: 'quality-profiles' },
} as const satisfies Partial<Record<SearchResultType, { segment: string }>>;

const TYPE_ORDER = Object.fromEntries(SEARCH_RESULT_TYPES.map((type, index) => [type, index])) as Record<
  SearchResultType,
  number
>;

/** Match one built PCD cache; throws when the cache is closed or rebuilt mid-query. */
async function searchPcdDatabase(
  params: SearchParams,
  needle: string,
  requested: readonly PcdEntityType[],
  cache: PCDCache,
  database: { id: number; name: string }
): Promise<Match[]> {
  const matches: Match[] = [];
  const source = { type: 'pcd' as const, id: database.id, name: database.name };
  for (const type of requested) {
    let hits = (await PCD_LOADERS[type](cache)).flatMap((row) => {
      const rank = rankName(row.name, needle);
      return rank === null ? [] : [{ row, rank }];
    });

    if (type === 'quality_profile' && params.arrType !== 'all' && hits.length > 0) {
      const compatible = await computeCompatibleProfileNames(
        cache,
        params.arrType,
        hits.map((hit) => hit.row.name)
      );
      hits = hits.filter((hit) => compatible.has(hit.row.name));
    }

    for (const { row, rank } of hits) {
      matches.push({
        rank,
        sourceOrder: database.id,
        result: {
          type,
          id: `pcd:${database.id}:${type}:${row.id}`,
          name: row.name,
          href: pcdHref(type, database.id, row),
          source,
        },
      });
    }
  }
  return matches;
}

async function searchPcd(params: SearchParams, needle: string, matches: Match[]): Promise<void> {
  const requested = PCD_ENTITY_TYPES.filter(
    (type) =>
      params.types.has(type) &&
      (type !== 'metadata_profile' || params.arrType === 'all' || supportsFeature(params.arrType, 'metadata_profiles'))
  );
  if (requested.length === 0) return;

  for (const database of pcdManager.getAll()) {
    if (params.databaseId !== null && database.id !== params.databaseId) continue;
    const cache = pcdManager.getCache(database.id);
    if (!cache || !cache.isBuilt()) continue;

    // A cache can be invalidated or rebuilt between the isBuilt() check and the queries; skip that
    // database (all-or-nothing, so no partial rows) instead of failing the whole search.
    try {
      matches.push(...(await searchPcdDatabase(params, needle, requested, cache, database)));
    } catch (error) {
      await logger.warn('Skipped database in search: cache query failed', {
        source: 'SearchService',
        meta: { databaseId: database.id, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

function searchTrash(params: SearchParams, needle: string, matches: Match[]): void {
  // TRaSH entities are not PCD rows; a databaseId filter scopes the search to one PCD database.
  if (params.databaseId !== null) return;
  const requested = (Object.keys(TRASH_ENTITY_TYPES) as Array<keyof typeof TRASH_ENTITY_TYPES>).filter((type) =>
    params.types.has(type)
  );
  if (requested.length === 0) return;

  for (const source of trashGuideSourcesQueries.getAll()) {
    if (!isTrashGuideSupportedArrType(source.arr_type)) continue;
    if (params.arrType !== 'all' && params.arrType !== source.arr_type) continue;

    const sourceRef = { type: 'trash' as const, id: source.id, name: source.name, arrType: source.arr_type };
    for (const type of requested) {
      const entityType: TrashGuideEntityType = type;
      for (const entity of trashGuideEntityCacheQueries.getNamesBySourceAndType(source.id, entityType)) {
        const rank = rankName(entity.name, needle);
        if (rank === null) continue;
        matches.push({
          rank,
          sourceOrder: source.id,
          result: {
            type,
            id: `trash:${source.id}:${type}:${entity.trashId}`,
            name: entity.name,
            href: `/databases/trash/${source.id}/${TRASH_ENTITY_TYPES[type].segment}/${encodeURIComponent(entity.trashId)}/`,
            source: sourceRef,
            arrType: source.arr_type,
          },
        });
      }
    }
  }
}

function searchArrInstances(params: SearchParams, needle: string, matches: Match[]): void {
  if (!params.types.has('arr_instance')) return;

  for (const instance of arrInstancesQueries.getAll()) {
    const arrType = isArrAppType(instance.type) ? instance.type : undefined;
    if (params.arrType !== 'all' && arrType !== params.arrType) continue;
    const rank = rankName(instance.name, needle);
    if (rank === null) continue;

    // Explicit projection: never spread the row (it carries url and api_key).
    const result: SearchResult = {
      type: 'arr_instance',
      id: `arr:${instance.id}`,
      name: instance.name,
      href: `/arr/${instance.id}`,
      source: null,
    };
    if (arrType) result.arrType = arrType;
    matches.push({ rank, sourceOrder: instance.id, result });
  }
}

function searchDatabases(params: SearchParams, needle: string, matches: Match[]): void {
  if (!params.types.has('database')) return;

  for (const database of pcdManager.getAll()) {
    const rank = rankName(database.name, needle);
    if (rank === null) continue;
    matches.push({
      rank,
      sourceOrder: database.id,
      result: {
        type: 'database',
        id: `database:${database.id}`,
        name: database.name,
        href: `/databases/${database.id}`,
        source: null,
      },
    });
  }
}

function compareMatches(a: Match, b: Match): number {
  return (
    a.rank - b.rank ||
    compareNames(a.result.name, b.result.name) ||
    TYPE_ORDER[a.result.type] - TYPE_ORDER[b.result.type] ||
    a.sourceOrder - b.sourceOrder ||
    a.result.id.localeCompare(b.result.id)
  );
}

/**
 * Pick at most `limit` matches from the ranked list. Each requested type first gets up to
 * `max(3, ceil(limit / requestedTypeCount))` slots in rank order, then remaining slots are
 * backfilled in rank order. Output keeps rank order. `truncated` is true iff any match is omitted.
 */
function selectResults(
  ranked: readonly Match[],
  params: SearchParams
): { results: SearchResult[]; truncated: boolean } {
  const perTypeCap = Math.max(3, Math.ceil(params.limit / params.types.size));
  const selected = new Array<boolean>(ranked.length).fill(false);
  const perTypeCount = new Map<SearchResultType, number>();
  let selectedCount = 0;

  for (let index = 0; index < ranked.length && selectedCount < params.limit; index++) {
    const type = ranked[index].result.type;
    const count = perTypeCount.get(type) ?? 0;
    if (count >= perTypeCap) continue;
    perTypeCount.set(type, count + 1);
    selected[index] = true;
    selectedCount++;
  }
  for (let index = 0; index < ranked.length && selectedCount < params.limit; index++) {
    if (selected[index]) continue;
    selected[index] = true;
    selectedCount++;
  }

  return {
    results: ranked.filter((_, index) => selected[index]).map((match) => match.result),
    truncated: selectedCount < ranked.length,
  };
}

/**
 * Run a validated search. Databases without a built cache, or whose cache fails mid-query (e.g.
 * invalidated by a concurrent rebuild), are skipped; any other failure propagates so the route can
 * log it and answer 500.
 */
export async function search(params: SearchParams): Promise<SearchResponse> {
  const needle = params.query.toLowerCase();
  const matches: Match[] = [];

  await searchPcd(params, needle, matches);
  searchTrash(params, needle, matches);
  searchArrInstances(params, needle, matches);
  searchDatabases(params, needle, matches);

  matches.sort(compareMatches);
  return { query: params.query, ...selectResults(matches, params) };
}
