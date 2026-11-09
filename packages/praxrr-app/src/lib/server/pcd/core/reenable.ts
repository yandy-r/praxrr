/**
 * Re-enable a PCD database that was auto-disabled after a failed cache build / import / override.
 *
 * `database_instances.enabled` is cleared by `disableDatabaseInstance()` whenever a compile or
 * rollback fails, and startup skips disabled instances, so without this nothing could restore it.
 *
 * The instance stays `enabled = 0` for the whole import + compile so enabled-gated paths (the
 * pcd.sync job handler, strategy-driven auto-override, writer-side recompiles in other flows) stay
 * out while the database is being rebuilt. It is flipped to `enabled = 1` only after the compile
 * succeeds; on any failure it stays disabled and no cache is left registered.
 *
 * The run holds the per-database override lock (shared with bundle import / conflict override /
 * override revert) so it cannot interleave with another writer that snapshots and restores the op
 * table. Cache serving is NOT gated on `enabled` (`getCache` reads the registry directly), and a
 * failed build leaves the previously registered cache in place; the stale cache is therefore
 * invalidated up front so neither readers nor `importBaseOps` (which reads the registered cache
 * for entity presence checks) see pre-failure state.
 */

import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import { withDatabaseOverrideLock } from '../conflicts/override.ts';
import { autoResolveOverrideConflicts, compile, invalidate } from '../database/compiler.ts';
import { getRegisteredCache } from '../database/registry.ts';
import { importBaseOps } from '../ops/importBaseOps.ts';
import { seedBuiltInBaseOps } from '../ops/seedBuiltInBaseOps.ts';
import { PCDError } from './errors.ts';

export type ReenableStatus = 'enabled' | 'already_enabled';

export interface ReenableResult {
  status: ReenableStatus;
}

export type ReenableErrorCode = 'not_found' | 'recompile_failed';

/**
 * Typed re-enable failure. `message` is generic and safe to return to clients; the underlying
 * exception is logged server-side and kept on `cause` only.
 */
export class ReenableError extends PCDError {
  constructor(
    public readonly code: ReenableErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = 'ReenableError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export const REENABLE_NOT_FOUND_MESSAGE = 'Database not found';
export const REENABLE_RECOMPILE_FAILED_MESSAGE =
  'Database could not be re-enabled because its configuration failed to compile. It remains disabled; check the server logs for details.';

/** Collapses concurrent re-enables of the same database into one run. */
const inFlight = new Map<number, Promise<ReenableResult>>();

async function failClosed(databaseId: number, name: string, error: unknown): Promise<never> {
  invalidate(databaseId);
  try {
    databaseInstancesQueries.disable(databaseId);
  } catch (disableError) {
    await logger.error('Failed to re-disable database after failed re-enable', {
      source: 'PCDReenable',
      meta: { databaseId, error: String(disableError) },
    });
  }
  await logger.error('Failed to re-enable database', {
    source: 'PCDReenable',
    meta: { databaseId, name, error: String(error) },
  });
  throw new ReenableError('recompile_failed', REENABLE_RECOMPILE_FAILED_MESSAGE, { cause: error });
}

async function runReenable(databaseId: number): Promise<ReenableResult> {
  // Re-read inside the lock: another writer may have changed the instance while this call queued.
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new ReenableError('not_found', REENABLE_NOT_FOUND_MESSAGE);
  }
  if (instance.enabled) {
    return { status: 'already_enabled' };
  }

  try {
    invalidate(databaseId);

    await seedBuiltInBaseOps(databaseId);
    await importBaseOps(databaseId, instance.local_path);
    // importBaseOps only compiles when it imported entity candidates.
    if (!getRegisteredCache(databaseId)) {
      await compile(instance.local_path, databaseId);
    }
    if (!getRegisteredCache(databaseId)) {
      throw new Error('Cache missing after recompile');
    }

    databaseInstancesQueries.enable(databaseId);

    // The compile above ran while disabled, so compile()'s enabled-gated auto-override resolution
    // was skipped; run it now through the same entry point. Matching a normal compile, an
    // individual override failure is logged and non-fatal inside it, while an exception it throws
    // propagates to the caller as a failed compile; here that fails closed (back to disabled, no
    // cache). A failed override rebuild disables the instance itself, so re-check afterwards.
    await autoResolveOverrideConflicts(databaseId);
    if (!databaseInstancesQueries.getById(databaseId)?.enabled || !getRegisteredCache(databaseId)) {
      throw new Error('Database disabled during override resolution');
    }
  } catch (error) {
    return await failClosed(databaseId, instance.name, error);
  }

  await logger.info(`Re-enabled database: ${instance.name}`, {
    source: 'PCDReenable',
    meta: { databaseId, name: instance.name },
  });
  return { status: 'enabled' };
}

export function reenableDatabase(databaseId: number): Promise<ReenableResult> {
  const existing = inFlight.get(databaseId);
  if (existing) return existing;

  const run = withDatabaseOverrideLock(databaseId, () => runReenable(databaseId)).finally(() => {
    inFlight.delete(databaseId);
  });
  inFlight.set(databaseId, run);
  return run;
}
