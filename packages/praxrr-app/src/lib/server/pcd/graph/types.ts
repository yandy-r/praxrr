/**
 * Dependency Graph — Types, Guards, and Caps
 *
 * Internal source-of-truth types for the read-only dependency graph over PCD config
 * entities. Structurally match the generated wire schema (`docs/api/v1/schemas/graph.yaml`
 * -> `components['schemas']['Graph*']`); the route handlers `satisfies`-check the wire
 * types at the boundary (mirrors resolved-config's `toWirePayload`).
 *
 * Per the repo Cross-Arr Semantic Validation Policy: `arrType` (including the distinct
 * `'all'`) is carried verbatim on every edge and never collapsed or sibling-substituted.
 */

import type { ArrType } from '$shared/pcd/types.ts';
import type { ArrAppType } from '$shared/arr/capabilities.ts';

// ============================================================================
// CORE UNIONS
// ============================================================================

/** Entity families a graph node can represent. `quality`/`quality_definition` are leaves (no editor route). */
export type NodeKind = 'custom_format' | 'regular_expression' | 'quality_profile' | 'quality' | 'quality_definition';

/** Relationship families. Direction is always referrer (`from`) -> dependency (`to`). */
export type EdgeKind =
  | 'quality_profile_custom_format'
  | 'custom_format_regular_expression'
  | 'quality_profile_quality'
  | 'quality_definition_quality';

/** Arr scope of an edge; `'all'` is a first-class, distinct value (never per-arr, never a QP-validity signal). */
export type GraphArrType = ArrType;

/** Impact traversal direction: reverse (who references me) or forward (who I reference). */
export type ImpactDirection = 'dependents' | 'dependencies';

// ============================================================================
// NODE / EDGE SHAPES
// ============================================================================

export interface NodeRef {
  kind: NodeKind;
  name: string;
}

export interface GraphNode {
  kind: NodeKind;
  name: string;
  /** Integer editor id for linkable kinds; null for leaf kinds (`quality`, `quality_definition`). */
  routeId: number | null;
  inDegree: number;
  outDegree: number;
  /** Present only for `quality_profile` and `quality` nodes. */
  compatibleArrTypes?: ArrAppType[];
}

export interface GraphEdge {
  from: NodeRef;
  to: NodeRef;
  edgeKind: EdgeKind;
  arrType: GraphArrType;
  /** Present only on `quality_profile_custom_format` edges. */
  score?: number | null;
  /** Present only on grouped `quality_profile_quality` edges. */
  groupName?: string | null;
}

export interface DependencyGraph {
  databaseId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  arrTypesPresent: GraphArrType[];
  truncated: boolean;
}

export interface GraphImpact {
  databaseId: number;
  node: GraphNode;
  direction: ImpactDirection;
  depth: number;
  edges: GraphEdge[];
  byArrType: Record<string, GraphEdge[]>;
  counts: Record<string, number>;
  hasDownstream: boolean;
  truncated: boolean;
}

// ============================================================================
// CAPS (bounded traversal / payload)
// ============================================================================

/** Default impact traversal depth when the caller does not specify one. */
export const IMPACT_DEFAULT_DEPTH = 2;
/** Hard upper bound on impact traversal depth (clamp target). */
export const IMPACT_MAX_DEPTH = 3;
/** Distinct-node visit cap for a single impact traversal; hitting it sets `truncated`. */
export const IMPACT_VISITED_CAP = 500;
/** Edge cap for the full-graph endpoint; exceeding it truncates and sets `truncated`. */
export const GRAPH_EDGE_CAP = 5000;

// ============================================================================
// NODE KIND GUARD
// ============================================================================

export const NODE_KINDS: readonly NodeKind[] = [
  'custom_format',
  'regular_expression',
  'quality_profile',
  'quality',
  'quality_definition',
];

const NODE_KIND_SET: ReadonlySet<string> = new Set<NodeKind>(NODE_KINDS);

export function isNodeKind(value: string): value is NodeKind {
  return NODE_KIND_SET.has(value);
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Caller-input problem: unknown `nodeKind`, invalid `arrType`/`direction`, or an
 * otherwise malformed request. Routes map this to 400.
 */
export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

/** Distinguishes a `GraphValidationError` (400) from any other error. */
export function isGraphValidationError(error: unknown): error is GraphValidationError {
  return error instanceof GraphValidationError;
}

/**
 * The requested `databaseId` has no built PCD cache (unknown or not yet initialized).
 * Mapped to 400 -- there is nothing to fall back to -- and deliberately NOT 404, which
 * is reserved for a genuine by-name node miss.
 */
export class GraphDatabaseNotFoundError extends Error {
  constructor(databaseId: number) {
    super(`Database ${databaseId} not found or not ready`);
    this.name = 'GraphDatabaseNotFoundError';
  }
}

/** Distinguishes a `GraphDatabaseNotFoundError` (400) from any other error. */
export function isGraphDatabaseNotFoundError(error: unknown): error is GraphDatabaseNotFoundError {
  return error instanceof GraphDatabaseNotFoundError;
}

/**
 * A well-formed request (valid kind/arrType) whose `(nodeKind, name)` matches no node in
 * the cache. Routes map this to 404.
 */
export class GraphNodeNotFoundError extends Error {
  constructor(kind: NodeKind, name: string) {
    super(`${kind} "${name}" not found`);
    this.name = 'GraphNodeNotFoundError';
  }
}

/** Distinguishes a `GraphNodeNotFoundError` (404) from a validation/db error or any other error. */
export function isGraphNodeNotFoundError(error: unknown): error is GraphNodeNotFoundError {
  return error instanceof GraphNodeNotFoundError;
}
