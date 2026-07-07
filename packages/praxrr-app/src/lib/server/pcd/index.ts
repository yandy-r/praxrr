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
  ResolvedConfigValidationError,
  isResolvedConfigValidationError,
  listResolvedEntityNames,
  readResolvedEntity,
} from './resolved/readers.ts';
export type {
  ArrAgnosticEntityType,
  PerArrEntityType,
  ResolvedEntityPayload,
  ResolvedEntityType,
  ResolvedLayer,
  ResolvedReaderFn,
} from './resolved/types.ts';
