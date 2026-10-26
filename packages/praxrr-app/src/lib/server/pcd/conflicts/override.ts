import { AsyncLocalStorage } from 'node:async_hooks';
import { withOpCreationRecorder, type CreatedOpRecord } from '$db/opCreationRecorder.ts';
import { databaseInstancesQueries, disableDatabaseInstance } from '$db/queries/databaseInstances.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { compile, invalidate } from '$pcd/index.ts';
import { withAutoOverrideSuppressed } from '$pcd/database/compiler.ts';
import type { WriteResult } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import {
  dropOp,
  parseJson,
  parseOpIdFromFilepath,
  type StoredDesiredState,
  type StoredOpMetadata,
  supersedeOp,
} from './overrideUtils.ts';
import {
  overrideCreate as cfOverrideCreate,
  overrideUpdate as cfOverrideUpdate,
} from '$pcd/entities/customFormats/override/index.ts';
import {
  overrideCreate as qpOverrideCreate,
  overrideUpdate as qpOverrideUpdate,
} from '$pcd/entities/qualityProfiles/override/index.ts';
import {
  overrideCreate as reOverrideCreate,
  overrideUpdate as reOverrideUpdate,
} from '$pcd/entities/regularExpressions/override.ts';
import {
  overrideCreate as dpOverrideCreate,
  overrideUpdate as dpOverrideUpdate,
} from '$pcd/entities/delayProfiles/override.ts';
import {
  overrideCreate as namingOverrideCreate,
  overrideUpdate as namingOverrideUpdate,
} from '$pcd/entities/mediaManagement/naming/override.ts';
import {
  overrideCreate as msOverrideCreate,
  overrideUpdate as msOverrideUpdate,
} from '$pcd/entities/mediaManagement/media-settings/override.ts';
import {
  overrideCreate as qdOverrideCreate,
  overrideUpdate as qdOverrideUpdate,
} from '$pcd/entities/mediaManagement/quality-definitions/override.ts';

type OverrideConflictResult = {
  success: boolean;
  error?: string;
};

async function overrideEntity(
  databaseId: number,
  metadata: StoredOpMetadata | null,
  desiredState: StoredDesiredState | null,
  operation: string
): Promise<WriteResult> {
  const entity = metadata?.entity;

  switch (entity) {
    case 'custom_format':
      return operation === 'create'
        ? cfOverrideCreate(databaseId, metadata, desiredState)
        : cfOverrideUpdate(databaseId, metadata, desiredState);
    case 'quality_profile':
      return operation === 'create'
        ? qpOverrideCreate(databaseId, metadata, desiredState)
        : qpOverrideUpdate(databaseId, metadata, desiredState);
    case 'regular_expression':
      return operation === 'create'
        ? reOverrideCreate(databaseId, metadata, desiredState)
        : reOverrideUpdate(databaseId, metadata, desiredState);
    case 'delay_profile':
      return operation === 'create'
        ? dpOverrideCreate(databaseId, metadata, desiredState)
        : dpOverrideUpdate(databaseId, metadata, desiredState);
    case 'radarr_naming':
    case 'sonarr_naming':
    case 'lidarr_naming':
      return operation === 'create'
        ? namingOverrideCreate(databaseId, metadata, desiredState)
        : namingOverrideUpdate(databaseId, metadata, desiredState);
    case 'radarr_media_settings':
    case 'sonarr_media_settings':
    case 'lidarr_media_settings':
      return operation === 'create'
        ? msOverrideCreate(databaseId, metadata, desiredState)
        : msOverrideUpdate(databaseId, metadata, desiredState);
    case 'radarr_quality_definitions':
    case 'sonarr_quality_definitions':
    case 'lidarr_quality_definitions':
      return operation === 'create'
        ? qdOverrideCreate(databaseId, metadata, desiredState)
        : qdOverrideUpdate(databaseId, metadata, desiredState);
    default:
      return {
        success: false,
        error: `Override not yet implemented for entity: ${entity}`,
      };
  }
}

// ── Per-database serialization ──

/** Database ids whose override lock the current async context already holds (re-entrancy). */
const heldDatabaseLocks = new AsyncLocalStorage<ReadonlySet<number>>();
/** Tail of each database's FIFO promise chain. */
const databaseLockTails = new Map<number, Promise<void>>();

/**
 * Serialize overrides per database: an override snapshots and restores the whole op table, so two
 * overlapping attempts would capture each other's writes. Re-entrant: a nested call from the same
 * async context (e.g. via a compile's auto-override) passes straight through instead of
 * deadlocking on itself.
 */
async function withDatabaseOverrideLock<T>(databaseId: number, fn: () => Promise<T>): Promise<T> {
  const held = heldDatabaseLocks.getStore();
  if (held?.has(databaseId)) return fn();

  const previous = databaseLockTails.get(databaseId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  databaseLockTails.set(databaseId, tail);

  await previous;
  try {
    return await heldDatabaseLocks.run(new Set([...(held ?? []), databaseId]), fn);
  } finally {
    release();
    if (databaseLockTails.get(databaseId) === tail) databaseLockTails.delete(databaseId);
  }
}

export function overrideConflict(input: { databaseId: number; opId: number }): Promise<OverrideConflictResult> {
  return withDatabaseOverrideLock(input.databaseId, () => overrideConflictLocked(input));
}

async function overrideConflictLocked(input: { databaseId: number; opId: number }): Promise<OverrideConflictResult> {
  const { databaseId, opId } = input;

  // Read inside the lock: a queued attempt may find the op already overridden by the one before it.
  const op = pcdOpsQueries.getById(opId);
  if (!op || op.database_id !== databaseId) {
    return { success: false, error: 'Conflict operation not found' };
  }

  if (op.origin !== 'user' || op.state !== 'published') {
    return {
      success: false,
      error: 'Only published user operations can be overridden',
    };
  }

  const metadata = parseJson<StoredOpMetadata>(op.metadata);
  const desiredState = parseJson<StoredDesiredState>(op.desired_state);
  const operation = metadata?.operation ?? 'update';

  const instance = databaseInstancesQueries.getById(databaseId);

  // Snapshot every op before the first write: the drop, the replacement op(s) the entity handler
  // writes (they can supersede other user ops) and the recompiles are one attempt that must be
  // all-or-nothing (YAN-465).
  const snapshot = pcdOpsQueries.listByDatabase(databaseId);
  const created: CreatedOpRecord = { opIds: [], historyIds: [], updatedOpIds: [] };

  /**
   * Undo the whole attempt: restore pre-existing ops verbatim (the original op back to
   * `published`) and delete every op/history row the attempt created (the `dropped` history row
   * included), so the original `conflicted` row is the latest again. Then rebuild the cache with
   * auto-override suppressed, otherwise the recompile would immediately retry this same override.
   */
  const restoreAfterFailure = async (reason: string): Promise<OverrideConflictResult> => {
    const wroteNothing =
      created.opIds.length === 0 && created.historyIds.length === 0 && created.updatedOpIds.length === 0;

    // Restore is synchronous and runs before any await, so nothing can interleave with it.
    let restoreError: unknown = null;
    if (!wroteNothing) {
      try {
        pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, created);
      } catch (error) {
        restoreError = error;
      }
    }

    await logger.error('Conflict override failed; restoring operation', {
      source: 'PCDConflicts',
      meta: { databaseId, opId, error: reason },
    });

    if (restoreError !== null) {
      // The rows may be a hybrid: disable the database (same signal as a failed cache build).
      let disabled = false;
      try {
        disabled = disableDatabaseInstance(databaseId);
      } catch {
        // Best effort: never let this replace the original override error.
      }
      invalidate(databaseId);
      await logger.error('Failed to restore operations after failed conflict override', {
        source: 'PCDConflicts',
        meta: { databaseId, opId, disabled, error: String(restoreError) },
      });
      return { success: false, error: reason };
    }

    if (wroteNothing) return { success: false, error: reason };

    // Rebuild so the cache reflects the restored rows. compile() swaps caches atomically; drop the
    // registered cache only when it cannot be rebuilt (instance disabled mid-attempt, or compile threw).
    const current = databaseInstancesQueries.getById(databaseId);
    if (!current?.enabled) {
      invalidate(databaseId);
      return { success: false, error: reason };
    }
    try {
      await withAutoOverrideSuppressed(databaseId, () => compile(current.local_path, databaseId));
    } catch (compileError) {
      invalidate(databaseId);
      await logger.error('Failed to recompile after restoring failed conflict override', {
        source: 'PCDConflicts',
        meta: { databaseId, opId, error: String(compileError) },
      });
    }
    return { success: false, error: reason };
  };

  const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  // Auto-override is suppressed for the whole attempt: the internal compiles and the writer's own
  // compile must not auto-resolve OTHER conflicts, whose writes would land in this attempt's
  // record and be rolled back with it. Remaining conflicts resolve on the next normal compile.
  if (operation === 'delete') {
    try {
      const failure = await withAutoOverrideSuppressed(databaseId, () =>
        withOpCreationRecorder(created, async () => {
          const dropped = await dropOp(databaseId, opId);
          if (!dropped) return 'Failed to drop conflicting delete operation';
          if (instance?.enabled) {
            await compile(instance.local_path, databaseId);
          }
          return null;
        })
      );
      if (failure) return restoreAfterFailure(failure);
    } catch (error) {
      return restoreAfterFailure(errorMessage(error));
    }

    await logger.info('Overrode conflict', {
      source: 'PCDConflicts',
      meta: { databaseId, opId },
    });

    return { success: true };
  }

  // Drop old op and recompile to get a clean cache before generating
  // the replacement.  Without this the override handler reads dirty
  // partial-execution state (e.g. guard-failed DELETEs but successful
  // INSERTs) and produces an op whose guards won't match the clean
  // upstream state after recompilation.
  let result: WriteResult;
  try {
    result = await withAutoOverrideSuppressed(databaseId, () =>
      withOpCreationRecorder(created, async () => {
        const dropped = await dropOp(databaseId, opId);
        if (!dropped) {
          return { success: false, error: 'Failed to drop conflicting operation for override' };
        }
        if (instance?.enabled) {
          await compile(instance.local_path, databaseId);
        }
        return overrideEntity(databaseId, metadata, desiredState, operation);
      })
    );
  } catch (error) {
    return restoreAfterFailure(errorMessage(error));
  }
  if (!result.success) {
    return restoreAfterFailure(result.error || 'Failed to override conflict');
  }

  // Link old → new for audit trail; writeOperation already recompiled
  const newOpId = parseOpIdFromFilepath(result.filepath ?? null);
  if (newOpId) {
    await supersedeOp(databaseId, opId, newOpId);
  }

  await logger.info('Overrode conflict', {
    source: 'PCDConflicts',
    meta: { databaseId, opId, newOpId },
  });

  return { success: true };
}
