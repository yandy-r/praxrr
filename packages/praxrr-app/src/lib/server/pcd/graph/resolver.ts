/**
 * Dependency Graph — Resolver
 *
 * On-demand assembly of the full graph (`buildDependencyGraph`) and bounded per-node
 * impact traversal (`getImpact`) over the `edges.ts` catalog. All reads are read-only
 * against the in-memory PCD cache; nothing is materialized or mutated. Traversals are
 * depth- and visit-capped and flag `truncated` when a cap is hit.
 */

import type { PCDCache } from '$pcd/database/cache.ts';
import type { ArrAppType } from '$shared/arr/capabilities.ts';
import { getAllEdges, getIncomingEdges, getOutgoingEdges } from './edges.ts';
import { getQualityCompatibility, getQualityProfileCompatibility } from './compat.ts';
import {
  GRAPH_EDGE_CAP,
  GraphNodeNotFoundError,
  IMPACT_MAX_DEPTH,
  IMPACT_VISITED_CAP,
  type DependencyGraph,
  type GraphArrType,
  type GraphEdge,
  type GraphImpact,
  type GraphNode,
  type ImpactDirection,
  type NodeKind,
  type NodeRef,
} from './types.ts';

const nodeKey = (ref: NodeRef): string => `${ref.kind}:${ref.name}`;

const edgeKey = (edge: GraphEdge): string =>
  `${edge.edgeKind}|${nodeKey(edge.from)}|${nodeKey(edge.to)}|${edge.arrType}|${edge.groupName ?? ''}`;

// ============================================================================
// NODE RESOLUTION (existence + editor routeId)
// ============================================================================

/** Base table + editor-id column for each linkable node kind; leaf kinds resolve to null routeId. */
async function resolveNode(
  cache: PCDCache,
  kind: NodeKind,
  name: string
): Promise<{ exists: boolean; routeId: number | null }> {
  switch (kind) {
    case 'custom_format':
      return resolveByIdTable(cache, 'custom_formats', name);
    case 'quality_profile':
      return resolveByIdTable(cache, 'quality_profiles', name);
    case 'regular_expression':
      return resolveByIdTable(cache, 'regular_expressions', name);
    case 'quality': {
      const row = await cache.kb.selectFrom('qualities').select('name').where('name', '=', name).executeTakeFirst();
      return { exists: !!row, routeId: null };
    }
    case 'quality_definition': {
      for (const table of [
        'radarr_quality_definitions',
        'sonarr_quality_definitions',
        'lidarr_quality_definitions',
      ] as const) {
        const row = await cache.kb.selectFrom(table).select('name').where('name', '=', name).executeTakeFirst();
        if (row) return { exists: true, routeId: null };
      }
      return { exists: false, routeId: null };
    }
  }
}

async function resolveByIdTable(
  cache: PCDCache,
  table: 'custom_formats' | 'quality_profiles' | 'regular_expressions',
  name: string
): Promise<{ exists: boolean; routeId: number | null }> {
  const row = await cache.kb.selectFrom(table).select('id').where('name', '=', name).executeTakeFirst();
  return { exists: !!row, routeId: row ? Number(row.id) : null };
}

// ============================================================================
// IMPACT (bounded traversal)
// ============================================================================

/**
 * Entities that reference (`dependents`) or are referenced by (`dependencies`) a single
 * node, via a bounded traversal. Throws `GraphNodeNotFoundError` when the node does not
 * exist. `depth` is clamped to `[1, IMPACT_MAX_DEPTH]`.
 */
export async function getImpact(
  cache: PCDCache,
  databaseId: number,
  focus: NodeRef,
  options: { direction?: ImpactDirection; depth?: number; arrType?: GraphArrType } = {}
): Promise<GraphImpact> {
  const direction: ImpactDirection = options.direction ?? 'dependents';
  const depth = clampDepth(options.depth);
  const arrType = options.arrType;

  const resolved = await resolveNode(cache, focus.kind, focus.name);
  if (!resolved.exists) {
    throw new GraphNodeNotFoundError(focus.kind, focus.name);
  }

  const { edges, truncated } = await traverse(cache, focus, direction, depth, arrType);

  const [incoming, outgoing] = await Promise.all([getIncomingEdges(cache, focus), getOutgoingEdges(cache, focus)]);
  const node: GraphNode = {
    kind: focus.kind,
    name: focus.name,
    routeId: resolved.routeId,
    inDegree: incoming.filter((edge) => keepForArr(edge.arrType, arrType)).length,
    outDegree: outgoing.filter((edge) => keepForArr(edge.arrType, arrType)).length,
    compatibleArrTypes: await focusCompatibility(cache, focus),
  };

  return {
    databaseId,
    node,
    direction,
    depth,
    edges,
    byArrType: groupByArrType(edges),
    counts: countRelated(edges, direction),
    hasDownstream: edges.length > 0,
    truncated,
  };
}

function clampDepth(depth: number | undefined): number {
  if (depth === undefined || Number.isNaN(depth)) return Math.min(2, IMPACT_MAX_DEPTH);
  return Math.max(1, Math.min(Math.trunc(depth), IMPACT_MAX_DEPTH));
}

async function traverse(
  cache: PCDCache,
  start: NodeRef,
  direction: ImpactDirection,
  depth: number,
  arrType: GraphArrType | undefined
): Promise<{ edges: GraphEdge[]; truncated: boolean }> {
  const visited = new Set<string>([nodeKey(start)]);
  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  let truncated = false;
  let frontier: NodeRef[] = [start];

  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: NodeRef[] = [];
    for (const node of frontier) {
      const raw =
        direction === 'dependents' ? await getIncomingEdges(cache, node) : await getOutgoingEdges(cache, node);
      const incident = raw.filter((edge) => keepForArr(edge.arrType, arrType));
      for (const edge of incident) {
        const ek = edgeKey(edge);
        if (!seenEdges.has(ek)) {
          seenEdges.add(ek);
          edges.push(edge);
        }
        const neighbor: NodeRef = direction === 'dependents' ? edge.from : edge.to;
        const nk = nodeKey(neighbor);
        if (!visited.has(nk)) {
          if (visited.size >= IMPACT_VISITED_CAP) {
            truncated = true;
            continue;
          }
          visited.add(nk);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  return { edges, truncated };
}

async function focusCompatibility(cache: PCDCache, focus: NodeRef): Promise<ArrAppType[] | undefined> {
  if (focus.kind === 'quality_profile') {
    return (await getQualityProfileCompatibility(cache)).get(focus.name) ?? [];
  }
  if (focus.kind === 'quality') {
    return (await getQualityCompatibility(cache)).get(focus.name) ?? [];
  }
  return undefined;
}

function groupByArrType(edges: GraphEdge[]): Record<string, GraphEdge[]> {
  const grouped: Record<string, GraphEdge[]> = {};
  for (const edge of edges) {
    (grouped[edge.arrType] ??= []).push(edge);
  }
  return grouped;
}

function countRelated(edges: GraphEdge[], direction: ImpactDirection): Record<string, number> {
  const seen = new Set<string>();
  const byKind: Record<string, number> = {};
  for (const edge of edges) {
    const related: NodeRef = direction === 'dependents' ? edge.from : edge.to;
    const key = nodeKey(related);
    if (seen.has(key)) continue;
    seen.add(key);
    byKind[related.kind] = (byKind[related.kind] ?? 0) + 1;
  }
  byKind.total = seen.size;
  return byKind;
}

// ============================================================================
// FULL GRAPH
// ============================================================================

/**
 * The whole dependency graph for a database. `arrType` keeps edges scoped to that arr
 * (plus `'all'`, except when `arrType==='all'` itself, which keeps only `'all'` edges);
 * `nodeKind` narrows to that kind plus its immediate neighbours. Node in/out degrees are
 * computed from the (arr-filtered) edge set. Edges are capped at `GRAPH_EDGE_CAP`.
 */
export async function buildDependencyGraph(
  cache: PCDCache,
  databaseId: number,
  options: { arrType?: GraphArrType; nodeKind?: NodeKind } = {}
): Promise<DependencyGraph> {
  const { arrType, nodeKind } = options;

  const allEdges = await getAllEdges(cache);
  let edges = allEdges.filter((edge) => keepForArr(edge.arrType, arrType));

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const edge of edges) {
    outDegree.set(nodeKey(edge.from), (outDegree.get(nodeKey(edge.from)) ?? 0) + 1);
    inDegree.set(nodeKey(edge.to), (inDegree.get(nodeKey(edge.to)) ?? 0) + 1);
  }

  const nodes = await buildNodes(cache, edges, inDegree, outDegree);

  let truncated = false;
  if (edges.length > GRAPH_EDGE_CAP) {
    edges = edges.slice(0, GRAPH_EDGE_CAP);
    truncated = true;
  }

  const scoped = nodeKind ? narrowToKind(nodes, edges, nodeKind) : { nodes, edges };
  const arrTypesPresent = [...new Set(scoped.edges.map((edge) => edge.arrType))];

  return { databaseId, nodes: scoped.nodes, edges: scoped.edges, arrTypesPresent, truncated };
}

function keepForArr(edgeArr: GraphArrType, filter: GraphArrType | undefined): boolean {
  if (!filter) return true;
  if (edgeArr === filter) return true;
  return filter !== 'all' && edgeArr === 'all';
}

async function buildNodes(
  cache: PCDCache,
  edges: GraphEdge[],
  inDegree: Map<string, number>,
  outDegree: Map<string, number>
): Promise<GraphNode[]> {
  const [customFormats, qualityProfiles, regularExpressions, qpCompat, qualityCompat] = await Promise.all([
    cache.kb.selectFrom('custom_formats').select(['id', 'name']).execute(),
    cache.kb.selectFrom('quality_profiles').select(['id', 'name']).execute(),
    cache.kb.selectFrom('regular_expressions').select(['id', 'name']).execute(),
    getQualityProfileCompatibility(cache),
    getQualityCompatibility(cache),
  ]);

  const nodes = new Map<string, GraphNode>();
  const put = (kind: NodeKind, name: string, routeId: number | null, compatibleArrTypes?: ArrAppType[]) => {
    const ref = { kind, name };
    const key = nodeKey(ref);
    if (nodes.has(key)) return;
    nodes.set(key, {
      kind,
      name,
      routeId,
      inDegree: inDegree.get(key) ?? 0,
      outDegree: outDegree.get(key) ?? 0,
      ...(compatibleArrTypes ? { compatibleArrTypes } : {}),
    });
  };

  // Main entity kinds: include every row so orphans (referenced by nothing) still appear.
  for (const row of customFormats) put('custom_format', row.name, Number(row.id));
  for (const row of qualityProfiles) put('quality_profile', row.name, Number(row.id), qpCompat.get(row.name) ?? []);
  for (const row of regularExpressions) put('regular_expression', row.name, Number(row.id));

  // Leaf kinds (quality, quality_definition): only those that participate in an edge.
  for (const edge of edges) {
    for (const ref of [edge.from, edge.to]) {
      if (ref.kind === 'quality') put('quality', ref.name, null, qualityCompat.get(ref.name) ?? []);
      else if (ref.kind === 'quality_definition') put('quality_definition', ref.name, null);
    }
  }

  return [...nodes.values()];
}

function narrowToKind(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeKind: NodeKind
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const keptEdges = edges.filter((edge) => edge.from.kind === nodeKind || edge.to.kind === nodeKind);
  const neededKeys = new Set<string>();
  for (const edge of keptEdges) {
    neededKeys.add(nodeKey(edge.from));
    neededKeys.add(nodeKey(edge.to));
  }
  const keptNodes = nodes.filter((node) => node.kind === nodeKind || neededKeys.has(nodeKey(node)));
  return { nodes: keptNodes, edges: keptEdges };
}
