/**
 * Dependency Graph — Edge catalog (E1–E4)
 *
 * The single source of the dependency edges, each computed on demand from the read-only
 * PCD cache. Direction is always referrer (`from`) -> dependency (`to`):
 *  - E1 quality_profile -> custom_format      (arr-scoped; scored)      `quality_profile_custom_formats`
 *  - E2 custom_format    -> regular_expression (arr-scoped via parent)   `condition_patterns` ⋈ `custom_format_conditions`
 *  - E3 quality_profile  -> quality            (not edge-arr-scoped)     `quality_profile_qualities` (+ `quality_group_members`)
 *  - E4 quality_definition -> quality          (arr-scoped by table)     `radarr|sonarr|lidarr_quality_definitions`
 *
 * E1/E2 reverse edges reuse the reverse-dependency readers in `references.ts` (the same
 * queries the delete/update handlers consume) so there is exactly one definition per edge
 * SQL. `'all'` is carried verbatim and never expanded; every arr-scoped edge resolves by
 * explicit `arr_type` with no sibling fallback.
 */

import type { PCDCache } from '$pcd/database/cache.ts';
import { getCustomFormatDependentScores, getRegularExpressionDependentConditions } from './references.ts';
import type { GraphArrType, GraphEdge, NodeRef } from './types.ts';

const qpRef = (name: string): NodeRef => ({ kind: 'quality_profile', name });
const cfRef = (name: string): NodeRef => ({ kind: 'custom_format', name });
const regexRef = (name: string): NodeRef => ({ kind: 'regular_expression', name });
const qualityRef = (name: string): NodeRef => ({ kind: 'quality', name });
const qdRef = (name: string): NodeRef => ({ kind: 'quality_definition', name });

/** Per-arr quality-definition tables, paired with the arr scope stamped on their E4 edges. */
const QUALITY_DEFINITION_TABLES = [
  { table: 'radarr_quality_definitions', arrType: 'radarr' },
  { table: 'sonarr_quality_definitions', arrType: 'sonarr' },
  { table: 'lidarr_quality_definitions', arrType: 'lidarr' },
] as const;

// ============================================================================
// E1: quality_profile -> custom_format
// ============================================================================

async function e1Reverse(cache: PCDCache, customFormatName: string): Promise<GraphEdge[]> {
  const rows = await getCustomFormatDependentScores(cache, customFormatName);
  return rows.map((row) => ({
    from: qpRef(row.quality_profile_name),
    to: cfRef(row.custom_format_name),
    edgeKind: 'quality_profile_custom_format',
    arrType: row.arr_type as GraphArrType,
    score: row.score,
  }));
}

async function e1Forward(cache: PCDCache, qualityProfileName: string): Promise<GraphEdge[]> {
  const rows = await cache.kb
    .selectFrom('quality_profile_custom_formats')
    .select(['quality_profile_name', 'custom_format_name', 'arr_type', 'score'])
    .where('quality_profile_name', '=', qualityProfileName)
    .execute();
  return rows.map((row) => ({
    from: qpRef(row.quality_profile_name),
    to: cfRef(row.custom_format_name),
    edgeKind: 'quality_profile_custom_format',
    arrType: row.arr_type as GraphArrType,
    score: row.score,
  }));
}

async function e1All(cache: PCDCache): Promise<GraphEdge[]> {
  const rows = await cache.kb
    .selectFrom('quality_profile_custom_formats')
    .select(['quality_profile_name', 'custom_format_name', 'arr_type', 'score'])
    .execute();
  return rows.map((row) => ({
    from: qpRef(row.quality_profile_name),
    to: cfRef(row.custom_format_name),
    edgeKind: 'quality_profile_custom_format',
    arrType: row.arr_type as GraphArrType,
    score: row.score,
  }));
}

// ============================================================================
// E2: custom_format -> regular_expression
// ============================================================================

async function e2Reverse(cache: PCDCache, regularExpressionName: string): Promise<GraphEdge[]> {
  const rows = await getRegularExpressionDependentConditions(cache, regularExpressionName);
  return rows.map((row) => ({
    from: cfRef(row.custom_format_name),
    to: regexRef(regularExpressionName),
    edgeKind: 'custom_format_regular_expression',
    arrType: (row.arr_type ?? 'all') as GraphArrType,
  }));
}

async function e2Forward(cache: PCDCache, customFormatName: string): Promise<GraphEdge[]> {
  const rows = await cache.kb
    .selectFrom('condition_patterns as cp')
    .innerJoin('custom_format_conditions as cfc', (join) =>
      join.onRef('cfc.custom_format_name', '=', 'cp.custom_format_name').onRef('cfc.name', '=', 'cp.condition_name')
    )
    .select(['cp.custom_format_name', 'cp.regular_expression_name', 'cfc.arr_type'])
    .where('cp.custom_format_name', '=', customFormatName)
    .orderBy('cp.regular_expression_name')
    .execute();
  return rows.map((row) => ({
    from: cfRef(row.custom_format_name),
    to: regexRef(row.regular_expression_name),
    edgeKind: 'custom_format_regular_expression',
    arrType: (row.arr_type ?? 'all') as GraphArrType,
  }));
}

async function e2All(cache: PCDCache): Promise<GraphEdge[]> {
  const rows = await cache.kb
    .selectFrom('condition_patterns as cp')
    .innerJoin('custom_format_conditions as cfc', (join) =>
      join.onRef('cfc.custom_format_name', '=', 'cp.custom_format_name').onRef('cfc.name', '=', 'cp.condition_name')
    )
    .select(['cp.custom_format_name', 'cp.regular_expression_name', 'cfc.arr_type'])
    .execute();
  return rows.map((row) => ({
    from: cfRef(row.custom_format_name),
    to: regexRef(row.regular_expression_name),
    edgeKind: 'custom_format_regular_expression',
    arrType: (row.arr_type ?? 'all') as GraphArrType,
  }));
}

// ============================================================================
// E3: quality_profile -> quality (direct + grouped; not edge-arr-scoped -> 'all')
// ============================================================================

function e3DirectQuery(cache: PCDCache) {
  return cache.kb
    .selectFrom('quality_profile_qualities')
    .select(['quality_profile_name', 'quality_name'])
    .where('quality_name', 'is not', null);
}

function e3GroupedQuery(cache: PCDCache) {
  return cache.kb
    .selectFrom('quality_profile_qualities as qpq')
    .innerJoin('quality_group_members as qgm', (join) =>
      join
        .onRef('qgm.quality_profile_name', '=', 'qpq.quality_profile_name')
        .onRef('qgm.quality_group_name', '=', 'qpq.quality_group_name')
    )
    .select(['qpq.quality_profile_name', 'qgm.quality_name', 'qgm.quality_group_name'])
    .where('qpq.quality_group_name', 'is not', null);
}

function e3DirectEdge(row: { quality_profile_name: string; quality_name: string | null }): GraphEdge {
  return {
    from: qpRef(row.quality_profile_name),
    to: qualityRef(row.quality_name ?? ''),
    edgeKind: 'quality_profile_quality',
    arrType: 'all',
  };
}

function e3GroupedEdge(row: {
  quality_profile_name: string;
  quality_name: string;
  quality_group_name: string | null;
}): GraphEdge {
  return {
    from: qpRef(row.quality_profile_name),
    to: qualityRef(row.quality_name),
    edgeKind: 'quality_profile_quality',
    arrType: 'all',
    groupName: row.quality_group_name ?? undefined,
  };
}

async function e3Forward(cache: PCDCache, qualityProfileName: string): Promise<GraphEdge[]> {
  const direct = await e3DirectQuery(cache).where('quality_profile_name', '=', qualityProfileName).execute();
  const grouped = await e3GroupedQuery(cache).where('qpq.quality_profile_name', '=', qualityProfileName).execute();
  return [...direct.map(e3DirectEdge), ...grouped.map(e3GroupedEdge)];
}

async function e3Reverse(cache: PCDCache, qualityName: string): Promise<GraphEdge[]> {
  const direct = await e3DirectQuery(cache).where('quality_name', '=', qualityName).execute();
  const grouped = await e3GroupedQuery(cache).where('qgm.quality_name', '=', qualityName).execute();
  return [...direct.map(e3DirectEdge), ...grouped.map(e3GroupedEdge)];
}

async function e3All(cache: PCDCache): Promise<GraphEdge[]> {
  const direct = await e3DirectQuery(cache).execute();
  const grouped = await e3GroupedQuery(cache).execute();
  return [...direct.map(e3DirectEdge), ...grouped.map(e3GroupedEdge)];
}

// ============================================================================
// E4: quality_definition -> quality (arr-scoped by table)
// ============================================================================

async function e4Forward(cache: PCDCache, qualityDefinitionName: string): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = [];
  for (const { table, arrType } of QUALITY_DEFINITION_TABLES) {
    const rows = await cache.kb
      .selectFrom(table)
      .select(['name', 'quality_name'])
      .where('name', '=', qualityDefinitionName)
      .execute();
    edges.push(...rows.map((row) => e4Edge(row.name, row.quality_name, arrType)));
  }
  return edges;
}

async function e4Reverse(cache: PCDCache, qualityName: string): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = [];
  for (const { table, arrType } of QUALITY_DEFINITION_TABLES) {
    const rows = await cache.kb
      .selectFrom(table)
      .select(['name', 'quality_name'])
      .where('quality_name', '=', qualityName)
      .execute();
    edges.push(...rows.map((row) => e4Edge(row.name, row.quality_name, arrType)));
  }
  return edges;
}

async function e4All(cache: PCDCache): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = [];
  for (const { table, arrType } of QUALITY_DEFINITION_TABLES) {
    const rows = await cache.kb.selectFrom(table).select(['name', 'quality_name']).execute();
    edges.push(...rows.map((row) => e4Edge(row.name, row.quality_name, arrType)));
  }
  return edges;
}

function e4Edge(definitionName: string, qualityName: string, arrType: GraphArrType): GraphEdge {
  return {
    from: qdRef(definitionName),
    to: qualityRef(qualityName),
    edgeKind: 'quality_definition_quality',
    arrType,
  };
}

// ============================================================================
// PUBLIC: incident-edge dispatch (used by the resolver's traversal)
// ============================================================================

/** Every edge in the graph (one row per relationship), unfiltered. */
export async function getAllEdges(cache: PCDCache): Promise<GraphEdge[]> {
  const [e1, e2, e3, e4] = await Promise.all([e1All(cache), e2All(cache), e3All(cache), e4All(cache)]);
  return [...e1, ...e2, ...e3, ...e4];
}

/** Edges where `node` is the dependency (`to`) — the entities that reference it. */
export async function getIncomingEdges(cache: PCDCache, node: NodeRef): Promise<GraphEdge[]> {
  switch (node.kind) {
    case 'custom_format':
      return e1Reverse(cache, node.name);
    case 'regular_expression':
      return e2Reverse(cache, node.name);
    case 'quality': {
      const [fromProfiles, fromDefinitions] = await Promise.all([
        e3Reverse(cache, node.name),
        e4Reverse(cache, node.name),
      ]);
      return [...fromProfiles, ...fromDefinitions];
    }
    case 'quality_profile':
    case 'quality_definition':
      return [];
  }
}

/** Edges where `node` is the referrer (`from`) — the entities it references. */
export async function getOutgoingEdges(cache: PCDCache, node: NodeRef): Promise<GraphEdge[]> {
  switch (node.kind) {
    case 'quality_profile': {
      const [toFormats, toQualities] = await Promise.all([e1Forward(cache, node.name), e3Forward(cache, node.name)]);
      return [...toFormats, ...toQualities];
    }
    case 'custom_format':
      return e2Forward(cache, node.name);
    case 'quality_definition':
      return e4Forward(cache, node.name);
    case 'quality':
    case 'regular_expression':
      return [];
  }
}
