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

import { writeOperation as persistOperation, canWriteToBase, withDeferredCompile } from './ops/writer.ts';
import { currentWriterApply } from './bundles/writerRedirect.ts';
import type { WriteOptions, WriteResult } from './core/types.ts';

export { canWriteToBase, withDeferredCompile };
export { parseOperationLayer } from './utils/operationLayer.ts';

/**
 * Persist an operation. Identical to `ops/writer.ts#writeOperation` unless a bundle-import writer
 * scope redirects it to an ephemeral sandbox (see `bundles/writerRedirect.ts`).
 */
export async function writeOperation(options: WriteOptions): Promise<WriteResult> {
  const apply = currentWriterApply();
  return apply ? apply(options) : persistOperation(options);
}

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
export { resolveEntityLineage } from './resolved/lineage/engine.ts';
export type { EntityLineageResult, ResolveEntityLineageInput } from './resolved/lineage/engine.ts';
export { compareAcrossInstances } from './resolved/compare.ts';
export type {
  CompareAcrossInstancesInput,
  CompareAcrossInstancesResult,
  CompareDeps,
  CompareInstanceResult,
  CompareReason,
} from './resolved/compare.ts';

// ============================================================================
// OVERRIDES
// ============================================================================

export {
  actionKeyOf,
  buildLocallyModifiedLookup,
  isOverrideRevertError,
  listLocallyModifiedEntities,
  listOverrides,
  OverrideRevertError,
  resolveUserOpEntities,
  revertEntityOverrides,
  undoLastAction,
  USER_OP_ACTION_ID_KEY,
} from './overrides/index.ts';
export type {
  OverrideRevertErrorReason,
  RevertEntityOverridesInput,
  RevertResult,
  UndoLastActionInput,
  UndoResult,
} from './overrides/index.ts';
export type {
  EntityGroup,
  EntityRef,
  LastAction,
  LocallyModifiedLookup,
  OverrideEntity,
  OverrideKind,
  OverrideOp,
  OverridesSnapshot,
} from './overrides/index.ts';

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

// ============================================================================
// ENTITY BUNDLES
// ============================================================================

export { withDatabaseOverrideLock } from './conflicts/override.ts';
export {
  BundleExportLimitError,
  BundleImportFailedError,
  BundleInvalidError,
  BundlePlanMismatchError,
  collectBundleClosure,
  exportBundle,
  importBundle,
} from './bundles/index.ts';
export type { BundleClosure, BundleEntityOutcome, BundleImportOptions, BundleImportReport } from './bundles/index.ts';
