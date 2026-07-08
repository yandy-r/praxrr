/**
 * PCD Public API
 * Re-exports for external consumers
 */

// ============================================================================
// MANAGER
// ============================================================================

export { pcdManager } from './core/manager.ts';

// ============================================================================
// CACHE
// ============================================================================

export { PCDCache } from './database/cache.ts';
export { getCache, getCachedDatabaseIds } from './database/registry.ts';
export { compile, invalidate, invalidateAll } from './database/compiler.ts';

// ============================================================================
// WRITER
// ============================================================================

export { writeOperation, canWriteToBase } from './ops/writer.ts';
export { parseOperationLayer } from './utils/operationLayer.ts';

// ============================================================================
// MANIFEST
// ============================================================================

export {
  loadManifest,
  readManifest,
  validateManifest,
  writeManifest,
  readReadme,
  writeReadme,
} from './manifest/manifest.ts';
export type { Manifest } from './manifest/manifest.ts';

// ============================================================================
// DEPENDENCIES
// ============================================================================

export { processDependencies, syncDependencies, validateDependencies } from './git/dependencies.ts';

// ============================================================================
// OPERATIONS
// ============================================================================

export { loadAllOperations } from './ops/loadOps.ts';
export {
  loadOperationsFromDir,
  validateOperations,
  getPCDPath,
  getUserOpsPath,
  getBaseOpsPath,
} from './utils/operations.ts';
export { compiledQueryToSql, formatValue } from './utils/sql.ts';

// ============================================================================
// TYPES
// ============================================================================

export type {
  CacheBuildStats,
  Operation,
  OperationLayer,
  OperationType,
  OperationMetadata,
  WritableLayer,
  WriteOptions,
  WriteResult,
  ValidationResult,
  LinkOptions,
  SyncResult,
} from './core/types.ts';

// ============================================================================
// SNAPSHOTS
// ============================================================================

export { snapshotService } from './snapshots/service.ts';
export type {
  SnapshotType,
  SnapshotTrigger,
  CreateAutoSnapshotInput,
  CreateManualSnapshotInput,
  PcdSnapshotDetail,
  PcdSnapshotFullDetail,
  PcdSnapshotListResponse,
  PcdSnapshotListOptions,
} from './snapshots/types.ts';

// ============================================================================
// ERRORS
// ============================================================================

export {
  PCDError,
  CacheBuildError,
  OperationError,
  ValidationError,
  DependencyError,
  ManifestValidationError,
} from './core/errors.ts';

// ============================================================================
// RESOLVED CONFIG
// ============================================================================

export {
  ARR_AGNOSTIC_READERS,
  PER_ARR_READERS,
  isReaderNotFoundMessage,
  isResolvedConfigValidationError,
  isResolvedEntityNotFoundError,
  listResolvedEntityNames,
  readResolvedEntity,
  ResolvedConfigValidationError,
  ResolvedEntityNotFoundError,
} from './resolved/readers.ts';
export type { ResolvedEntityPayload, ResolvedEntityType, ResolvedLayer } from './resolved/types.ts';
export { computeLiveDiff } from './resolved/liveDiff.ts';
export type { LiveDiffDeps, LiveDiffReason, LiveDiffResult } from './resolved/liveDiff.ts';
export { COMPARE_MAX_INSTANCES, isInstanceCountWithinCap, registerCompareAttempt } from './resolved/limits.ts';
export { ResolvedConfigDatabaseNotFoundError, withBaseOnlyCache } from './resolved/layers.ts';
export {
  buildPendingConflictIndex,
  computeUserOverrides,
  PORTABLE_ARRAY_KEY_STRATEGIES,
  readEntityOrNull,
  resolveLayerState,
} from './resolved/layerDiff.ts';
export type { PendingConflictLookup } from './resolved/layerDiff.ts';
export { compareAcrossInstances } from './resolved/compare.ts';
export type {
  CompareAcrossInstancesInput,
  CompareAcrossInstancesResult,
  CompareDeps,
  CompareInstanceResult,
  CompareReason,
} from './resolved/compare.ts';

// ============================================================================
// DEPENDENCY GRAPH
// ============================================================================

export { buildDependencyGraph, getImpact } from './graph/resolver.ts';
export { getCustomFormatDependentScores, getRegularExpressionDependentConditions } from './graph/references.ts';
export type {
  CustomFormatDependentScoreOptions,
  CustomFormatDependentScoreOrderColumn,
  CustomFormatDependentScoreRow,
  RegularExpressionDependentConditionRow,
} from './graph/references.ts';
export {
  GRAPH_EDGE_CAP,
  GraphDatabaseNotFoundError,
  GraphNodeNotFoundError,
  GraphValidationError,
  IMPACT_DEFAULT_DEPTH,
  IMPACT_MAX_DEPTH,
  isGraphDatabaseNotFoundError,
  isGraphNodeNotFoundError,
  isGraphValidationError,
  isNodeKind,
  NODE_KINDS,
} from './graph/types.ts';
export type {
  DependencyGraph,
  GraphArrType,
  GraphEdge,
  GraphImpact,
  GraphNode,
  ImpactDirection,
  NodeKind,
  NodeRef,
} from './graph/types.ts';
