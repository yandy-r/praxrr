/**
 * Re-enable a PCD database that was auto-disabled after a failed cache build / import / override.
 *
 * `database_instances.enabled` is cleared by `disableDatabaseInstance()` whenever a compile or
 * rollback fails, and startup skips disabled instances, so without this nothing could restore it.
 * The database is only served again when a fresh import + compile succeeds; otherwise it stays
 * disabled and no cache is left registered.
 */

import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import { compile, invalidate } from '../database/compiler.ts';
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

/** Serializes concurrent re-enables of the same database: later callers share the first run. */
const inFlight = new Map<number, Promise<ReenableResult>>();

async function runReenable(databaseId: number): Promise<ReenableResult> {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new ReenableError('not_found', REENABLE_NOT_FOUND_MESSAGE);
  }
  if (instance.enabled) {
    return { status: 'already_enabled' };
  }

  // Enable before compiling so compile-time behavior that is gated on `enabled` (strategy-driven
  // auto-override resolution) matches a normal compile. Any failure below disables it again.
  databaseInstancesQueries.enable(databaseId);
  try {
    // A failed build leaves the previously registered cache in place; never serve it.
    invalidate(databaseId);

    await seedBuiltInBaseOps(databaseId);
    await importBaseOps(databaseId, instance.local_path);
    // importBaseOps only compiles when it imported entity candidates.
    if (!getRegisteredCache(databaseId)) {
      await compile(instance.local_path, databaseId);
    }
  } catch (error) {
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
      meta: { databaseId, name: instance.name, error: String(error) },
    });
    throw new ReenableError('recompile_failed', REENABLE_RECOMPILE_FAILED_MESSAGE, { cause: error });
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

  const run = runReenable(databaseId).finally(() => {
    inFlight.delete(databaseId);
  });
  inFlight.set(databaseId, run);
  return run;
}
