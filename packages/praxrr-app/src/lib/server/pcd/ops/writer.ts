/**
 * PCD Operation Writer (DB-first)
 * Writes operations to pcd_ops instead of filesystem layers.
 */

import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { buildContentHash, type PcdOpSource, pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { PcdOpOrigin } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { compiledQueryToSql } from '../utils/sql.ts';
import { compile } from '../database/compiler.ts';
import { getCache } from '../database/registry.ts';
import type { OperationLayer, OperationMetadata, OperationType, WriteOptions, WriteResult } from '../core/types.ts';
import type { ConflictStrategy } from '$pcd/conflicts/autoAlign/index.ts';
import {
  evaluateValueGuardApply,
  evaluateValueGuardError,
  isValueGuardBlockingStatus,
} from '../migration/valueGuardGate.ts';
import { uuid } from '$shared/utils/uuid.ts';

interface RepoImportWriteContext {
  filenamePrefix: string;
  sequenceStart: number;
  nextIndex: number;
  lastSeenInRepoAt: string;
  maxOperations: number;
}

interface WriteContextFrame {
  source?: PcdOpSource;
  allowBaseImport?: boolean;
  repoImport?: RepoImportWriteContext;
}

const writeContextStorage = new AsyncLocalStorage<WriteContextFrame[]>();

function currentWriteContext(): WriteContextFrame | undefined {
  const stack = writeContextStorage.getStore();
  if (!stack || stack.length === 0) return undefined;
  return stack[stack.length - 1];
}

interface RepoImportIdentity {
  filename: string;
  opNumber: number | null;
  sequence: number;
  lastSeenInRepoAt: string;
}

function consumeRepoImportIdentity(layer: OperationLayer, source: PcdOpSource): RepoImportIdentity | null {
  const repoImport = currentWriteContext()?.repoImport;
  if (!repoImport || layer !== 'base' || source !== 'repo') {
    return null;
  }

  if (repoImport.nextIndex >= repoImport.maxOperations) {
    throw new Error(`Migration repo import emitted too many SQL operations for "${repoImport.filenamePrefix}"`);
  }

  const index = repoImport.nextIndex;
  repoImport.nextIndex += 1;
  const suffix = String(index).padStart(5, '0');

  return {
    // Repo import filenames are synthetic, deterministic identifiers used for
    // pcd_ops lineage and should not be interpreted as import file paths.
    filename: `${repoImport.filenamePrefix}#${suffix}.sql`,
    opNumber: null,
    sequence: repoImport.sequenceStart + index,
    lastSeenInRepoAt: repoImport.lastSeenInRepoAt,
  };
}

export async function withRepoImportWriteContext<T>(
  options: {
    filenamePrefix: string;
    sequenceStart: number;
    maxOperations: number;
    lastSeenInRepoAt: string;
  },
  callback: () => Promise<T>
): Promise<T> {
  const parent = writeContextStorage.getStore() ?? [];
  const nextContext: WriteContextFrame = {
    source: 'repo',
    allowBaseImport: true,
    repoImport: {
      filenamePrefix: options.filenamePrefix,
      sequenceStart: options.sequenceStart,
      nextIndex: 0,
      maxOperations: options.maxOperations,
      lastSeenInRepoAt: options.lastSeenInRepoAt,
    },
  };
  const nextStack: WriteContextFrame[] = [...parent, nextContext];

  return writeContextStorage.run(nextStack, callback);
}

function buildMetadataJson(metadata?: OperationMetadata): string | null {
  if (!metadata) return null;
  const payload: Record<string, unknown> = {
    operation: metadata.operation,
    entity: metadata.entity,
    name: metadata.name,
  };
  if (metadata.previousName) {
    payload.previousName = metadata.previousName;
  }
  if (metadata.summary) {
    payload.summary = metadata.summary;
  }
  if (metadata.title) {
    payload.title = metadata.title;
  }
  if (metadata.changedFields && metadata.changedFields.length > 0) {
    payload.changed_fields = metadata.changedFields;
  }
  if (metadata.stableKey) {
    payload.stable_key = metadata.stableKey;
  }
  if (metadata.groupId) {
    payload.group_id = metadata.groupId;
  }
  if (metadata.generated) {
    payload.generated = true;
  }
  if (metadata.dependsOn && metadata.dependsOn.length > 0) {
    payload.depends_on = metadata.dependsOn;
  }
  return JSON.stringify(payload);
}

function serializeDesiredState(desiredState?: Record<string, unknown> | null): string | null {
  if (!desiredState) return null;
  return JSON.stringify(desiredState);
}

interface MigrationSqlOperation {
  sql: string;
  metadata?: OperationMetadata;
  desiredState?: Record<string, unknown> | null;
  source?: PcdOpSource;
}

interface WriteSqlOperationsOptions {
  databaseId: number;
  layer: OperationLayer;
  description: string;
  operations: MigrationSqlOperation[];
  source?: PcdOpSource;
  runValueGuardGate?: boolean;
}

type ValueGuardGateResult = { ok: true } | { ok: false; error: string };

function normalizeSql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}

function serializeMigrationSqlOperation(operation: MigrationSqlOperation): {
  sql: string;
  metadataJson: string | null;
  desiredStateJson: string | null;
} {
  return {
    sql: normalizeSql(operation.sql),
    metadataJson: buildMetadataJson(operation.metadata),
    desiredStateJson: serializeDesiredState(operation.desiredState),
  };
}

function resolveConflictStrategy(conflictStrategy: string | undefined): ConflictStrategy {
  if (conflictStrategy === 'override' || conflictStrategy === 'align' || conflictStrategy === 'ask') {
    return conflictStrategy;
  }

  throw new Error(`Invalid conflict strategy in database configuration: ${String(conflictStrategy)}`);
}

function runValueGuardGate(
  databaseId: number,
  layer: OperationLayer,
  operations: MigrationSqlOperation[]
): ValueGuardGateResult {
  if (layer !== 'user') {
    return { ok: true };
  }

  const cache = getCache(databaseId);
  if (!cache) {
    return { ok: false, error: 'Value-guard validation unavailable: cache not built' };
  }

  const cacheDb = cache.getRawDb();
  if (!cacheDb) {
    return { ok: false, error: 'Value-guard validation unavailable: cache not built' };
  }

  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new Error(`Failed to resolve database instance ${databaseId} for value-guard execution`);
  }

  const conflictStrategy = resolveConflictStrategy(instance.conflict_strategy);

  cacheDb.exec('SAVEPOINT pcd_writer_value_guard');
  try {
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const { sql, metadataJson, desiredStateJson } = serializeMigrationSqlOperation(operation);
      if (sql.length === 0) {
        continue;
      }

      const beforeChanges = cacheDb.totalChanges;
      try {
        cacheDb.exec(sql);
      } catch (error) {
        const errorStr = String(error);
        const gateError = evaluateValueGuardError({
          conflictStrategy,
          error: errorStr,
          isUserOp: true,
          trackHistory: true,
          priorConflictReason: null,
        });

        if (isValueGuardBlockingStatus(gateError.status) || !gateError.shouldRecordHistory) {
          return {
            ok: false,
            error: `Value-guard gate failed to execute operation ${i + 1}: ${errorStr}`,
          };
        }

        continue;
      }

      const rowcount = cacheDb.totalChanges - beforeChanges;
      const gateResult = evaluateValueGuardApply({
        conflictStrategy,
        isUserOp: true,
        rowcount,
        db: cacheDb,
        metadataJson,
        desiredStateJson,
        priorConflictReason: null,
      });

      if (isValueGuardBlockingStatus(gateResult.status)) {
        return {
          ok: false,
          error: `Value-guard gate rejected operation ${i + 1} (${
            operation.metadata?.entity ?? 'operation'
          } "${operation.metadata?.name ?? ''}"): ${gateResult.conflictReason ?? gateResult.status}`,
        };
      }
    }

    return { ok: true };
  } finally {
    cacheDb.exec('ROLLBACK TO SAVEPOINT pcd_writer_value_guard');
    cacheDb.exec('RELEASE SAVEPOINT pcd_writer_value_guard');
  }
}

export function __testOnly_runValueGuardGate(
  databaseId: number,
  layer: OperationLayer,
  operations: MigrationSqlOperation[]
): ValueGuardGateResult {
  return runValueGuardGate(databaseId, layer, operations);
}

async function cancelOutCreate(databaseId: number, origin: PcdOpOrigin, metadata: OperationMetadata): Promise<boolean> {
  if (metadata.operation !== 'delete') {
    return false;
  }

  const candidates = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, origin, {
    source: 'local',
    states: ['published', 'draft'],
  });

  async function hasDependentOps(
    createdOpId: number,
    createdMeta: ParsedMetadata,
    createdStableKey: { key?: string; value?: string } | undefined
  ): Promise<boolean> {
    for (const op of candidates) {
      if (op.id <= createdOpId) continue;
      if (!op.metadata) continue;

      let parsed: ParsedMetadata;
      try {
        parsed = JSON.parse(op.metadata) as ParsedMetadata;
      } catch (error) {
        await logger.debug('Failed to parse operation metadata while checking cancel-out dependencies', {
          source: 'PCDWriter',
          meta: {
            databaseId,
            operationId: op.id,
            metadata: op.metadata,
            error: String(error),
          },
        });
        continue;
      }

      const opStableKey = parsed.stable_key;
      if (
        createdStableKey?.key &&
        opStableKey?.key === createdStableKey.key &&
        opStableKey?.value === createdStableKey.value
      ) {
        return true;
      }

      if (
        createdMeta.entity &&
        createdMeta.name &&
        parsed.entity === createdMeta.entity &&
        parsed.name === createdMeta.name
      ) {
        return true;
      }

      if (createdMeta.entity === 'test_entity' && createdStableKey?.value) {
        const [entityType, entityTmdbIdRaw] = createdStableKey.value.split(':');
        const entityTmdbId = Number(entityTmdbIdRaw);
        if (!entityType || Number.isNaN(entityTmdbId)) {
          continue;
        }

        if (parsed.entity === 'test_release') {
          if (opStableKey?.value && opStableKey.value.startsWith(`${entityType}:${entityTmdbId}:`)) {
            return true;
          }

          if (op.desired_state) {
            try {
              const desired = JSON.parse(op.desired_state) as {
                entity_type?: string;
                entity_tmdb_id?: number;
              };
              if (desired.entity_type === entityType && desired.entity_tmdb_id === entityTmdbId) {
                return true;
              }
            } catch (error) {
              await logger.debug('Failed to parse desired state while checking cancel-out dependencies', {
                source: 'PCDWriter',
                meta: {
                  databaseId,
                  operationId: op.id,
                  desiredState: op.desired_state,
                  error: String(error),
                },
              });
            }
          }
        }
      }
    }

    return false;
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (!candidate.metadata) continue;

    let parsed: ParsedMetadata;
    try {
      parsed = JSON.parse(candidate.metadata) as ParsedMetadata;
    } catch (error) {
      await logger.debug('Failed to parse candidate operation metadata while checking cancel-out', {
        source: 'PCDWriter',
        meta: {
          databaseId,
          operationId: candidate.id,
          metadata: candidate.metadata,
          error: String(error),
        },
      });
      continue;
    }

    if (parsed.operation === 'create' && parsed.entity === metadata.entity && parsed.name === metadata.name) {
      if (await hasDependentOps(candidate.id, parsed, parsed.stable_key)) {
        return false;
      }
      pcdOpsQueries.update(candidate.id, { state: 'dropped' });
      await logger.info('Cancelled out local create operation with delete', {
        source: 'PCDWriter',
        meta: {
          databaseId,
          opId: candidate.id,
          entity: metadata.entity,
          name: metadata.name,
        },
      });
      return true;
    }
  }

  return false;
}

type ParsedMetadata = {
  operation?: string;
  entity?: string;
  name?: string;
  stable_key?: { key?: string; value?: string };
  changed_fields?: string[];
};

function parseMetadata(raw: string | null): ParsedMetadata | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedMetadata;
  } catch (error) {
    const preview = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
    void logger.debug('Failed to parse operation metadata while checking supersede', {
      source: 'PCDWriter',
      meta: { raw: preview, error: String(error) },
    });
    return null;
  }
}

function matchesStableKey(
  stableKey: OperationMetadata['stableKey'] | undefined,
  otherStableKey: ParsedMetadata['stable_key'] | undefined
): boolean | null {
  if (stableKey?.key && stableKey.value && otherStableKey?.key && otherStableKey.value) {
    return stableKey.key === otherStableKey.key && stableKey.value === otherStableKey.value;
  }
  return null;
}

function hasFieldCoverage(newFields: string[] | undefined, oldFields: string[] | undefined): boolean {
  if (!newFields || newFields.length === 0) return false;
  if (!oldFields || oldFields.length === 0) return false;
  const newSet = new Set(newFields);
  return oldFields.every((field) => newSet.has(field));
}

async function supersedePriorUserOps(databaseId: number, newOpId: number, metadata: OperationMetadata): Promise<void> {
  if (metadata.operation === 'create') {
    return;
  }

  const candidates = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', {
    states: ['published'],
  });

  const batchId = uuid();
  const superseded: number[] = [];

  for (const op of candidates) {
    if (op.id === newOpId || !op.metadata) continue;
    const parsed = parseMetadata(op.metadata);
    if (!parsed?.entity) continue;
    if (parsed.operation === 'create') continue;
    if (parsed.entity !== metadata.entity) continue;

    const stableKeyMatch = matchesStableKey(metadata.stableKey, parsed.stable_key);
    if (stableKeyMatch === false) {
      continue;
    }

    if (stableKeyMatch !== true && (!parsed.name || !metadata.name || parsed.name !== metadata.name)) {
      continue;
    }

    if (metadata.operation === 'update') {
      if (parsed.operation !== 'update') {
        continue;
      }
      if (!hasFieldCoverage(metadata.changedFields, parsed.changed_fields)) {
        continue;
      }
    }

    const updated = pcdOpsQueries.update(op.id, {
      state: 'superseded',
      supersededByOpId: newOpId,
    });
    if (!updated) continue;

    pcdOpHistoryQueries.create({
      opId: op.id,
      databaseId,
      batchId,
      status: 'superseded',
    });
    superseded.push(op.id);
  }

  if (superseded.length > 0) {
    await logger.info('Superseded prior user ops', {
      source: 'PCDWriter',
      meta: {
        databaseId,
        newOpId,
        entity: metadata.entity,
        name: metadata.name,
        supersededOpIds: superseded,
      },
    });
  }
}

/**
 * Write operations to a PCD layer in the database
 *
 * For base layer:
 *   - repo source: inserts a published base op (origin=base, state=published, source=repo)
 *   - local source: inserts a draft base op (origin=base, state=draft, source=local)
 * For user layer: inserts a published user op (origin=user, state=published)
 */
async function writeOperationsFromSqlOperations(options: WriteSqlOperationsOptions): Promise<WriteResult> {
  const { databaseId, layer, description } = options;
  const operations = options.operations;
  if (!operations || operations.length === 0) {
    return { success: false, error: 'No SQL operations provided' };
  }

  try {
    const instance = databaseInstancesQueries.getById(databaseId);
    if (!instance) {
      throw new Error(`Cannot write operations for missing database instance ${databaseId}`);
    }

    const context = currentWriteContext();
    const source =
      layer === 'base' && context?.allowBaseImport === true && context?.source === 'repo'
        ? 'repo'
        : (options.source ?? context?.source ?? 'local');
    const hasPersonalAccessToken = !!instance.has_personal_access_token || !!instance.personal_access_token;
    const allowBaseImportBypass = context?.allowBaseImport === true && source === 'repo';
    if (layer === 'base' && (!hasPersonalAccessToken || instance.local_ops_enabled) && !allowBaseImportBypass) {
      return {
        success: false,
        error: 'Base layer requires a personal access token and local ops must be disabled',
      };
    }

    const sqlStatements = operations.map((operation) => normalizeSql(operation.sql));
    const fastPathRepoImport = layer === 'base' && source === 'repo' && !!context?.repoImport;

    // Validate against current cache
    const cache = getCache(databaseId);
    if (cache) {
      const validation = cache.validateSql(sqlStatements);
      if (!validation.valid) {
        await logger.error('Operation validation failed - refusing to write', {
          source: 'PCDWriter',
          meta: {
            databaseId,
            layer,
            description,
            error: validation.error,
            queries: sqlStatements,
          },
        });
        return {
          success: false,
          error: `Validation failed: ${validation.error}`,
        };
      }
    } else {
      await logger.warn('No cache available for validation - proceeding without validation', {
        source: 'PCDWriter',
        meta: { databaseId, description },
      });
    }

    if (options.runValueGuardGate) {
      const gateResult = runValueGuardGate(databaseId, layer, operations);
      if (!gateResult.ok) {
        return {
          success: false,
          error: gateResult.error,
        };
      }
    }

    let lastOpId: number | null = null;

    for (const operation of operations) {
      const { sql, metadataJson, desiredStateJson } = serializeMigrationSqlOperation(operation);
      const importIdentity = consumeRepoImportIdentity(layer, source);

      if (operation.metadata && (await cancelOutCreate(databaseId, layer, operation.metadata))) {
        continue;
      }

      const contentHash = await buildContentHash(sql, metadataJson);
      let opId: number;
      if (layer === 'base' && source === 'repo' && importIdentity) {
        const existing = pcdOpsQueries.getBaseByFilename(databaseId, importIdentity.filename);
        if (existing) {
          pcdOpsQueries.update(existing.id, {
            state: 'published',
            source: 'repo',
            filename: importIdentity.filename,
            opNumber: importIdentity.opNumber,
            sequence: importIdentity.sequence,
            sql,
            metadata: metadataJson,
            desiredState: desiredStateJson,
            contentHash,
            lastSeenInRepoAt: importIdentity.lastSeenInRepoAt,
          });
          opId = existing.id;
        } else {
          opId = pcdOpsQueries.create({
            databaseId,
            origin: 'base',
            state: 'published',
            source: 'repo',
            filename: importIdentity.filename,
            opNumber: importIdentity.opNumber,
            sequence: importIdentity.sequence,
            sql,
            metadata: metadataJson,
            desiredState: desiredStateJson,
            contentHash,
            lastSeenInRepoAt: importIdentity.lastSeenInRepoAt,
          });
        }
      } else {
        opId = pcdOpsQueries.create({
          databaseId,
          origin: layer === 'base' ? 'base' : 'user',
          state: layer === 'base' ? (source === 'repo' ? 'published' : 'draft') : 'published',
          source,
          sql,
          metadata: metadataJson,
          desiredState: desiredStateJson,
          contentHash,
        });
      }
      lastOpId = opId;

      const opType = operation.metadata?.operation ?? 'write';
      const entity = operation.metadata?.entity?.replace(/_/g, ' ') ?? 'operation';
      const entityName = operation.metadata?.name ?? '';
      const message = `${opType.charAt(0).toUpperCase() + opType.slice(1)} ${entity} "${entityName}" in ${layer} layer`;

      if (operation.metadata?.operation === 'create' || operation.metadata?.operation === 'delete') {
        await logger.info(message, {
          source: 'PCDWriter',
          meta: {
            databaseId,
            opId,
            layer,
            entity: operation.metadata.entity,
            name: operation.metadata.name,
          },
        });
      }

      if (
        layer === 'user' &&
        operation.metadata &&
        (operation.metadata.operation === 'update' || operation.metadata.operation === 'delete')
      ) {
        await supersedePriorUserOps(databaseId, opId, operation.metadata);
      }

      if (fastPathRepoImport && cache) {
        const rawDb = cache.getRawDb();
        if (!rawDb) {
          throw new Error('Cache not built for repo import fast-path apply');
        }

        rawDb.exec(sql);
      }
    }

    if (fastPathRepoImport) {
      await logger.debug('Skipped full cache recompile for repo import write', {
        source: 'PCDWriter',
        meta: { databaseId },
      });
    } else {
      await compile(instance.local_path, instance.id);

      await logger.debug('Cache recompiled after write', {
        source: 'PCDWriter',
        meta: { databaseId },
      });
    }

    return {
      success: true,
      filepath: lastOpId ? `pcd_ops:${lastOpId}` : undefined,
    };
  } catch (error) {
    await logger.error('Failed to write operation', {
      source: 'PCDWriter',
      meta: {
        error: String(error),
        databaseId,
        layer,
        description,
        source: options.source,
      },
    });
    throw error;
  }
}

export function writeOperation(options: WriteOptions): Promise<WriteResult> {
  const sqlContent = options.queries.map(compiledQueryToSql).join(';\n\n');
  return writeOperationsFromSqlOperations({
    databaseId: options.databaseId,
    layer: options.layer,
    description: options.description,
    operations: [
      {
        sql: `${sqlContent};`,
        metadata: options.metadata,
        desiredState: options.desiredState,
      },
    ],
    source: 'local',
    runValueGuardGate: false,
  });
}

export function writeOperationsFromSql(options: WriteSqlOperationsOptions): Promise<WriteResult> {
  return writeOperationsFromSqlOperations({
    ...options,
    source: options.source ?? 'import',
    runValueGuardGate: true,
  });
}

/**
 * Check if a database instance can write to the base layer
 */
export function canWriteToBase(databaseId: number): boolean {
  const instance = databaseInstancesQueries.getById(databaseId);
  return (!!instance?.has_personal_access_token || !!instance?.personal_access_token) && !instance?.local_ops_enabled;
}

// Re-export types for convenience
export type { OperationMetadata, OperationType, WriteOptions, WriteResult };
