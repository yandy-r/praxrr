/**
 * Staged backup restore: startup apply.
 *
 * Runs before the application database is opened. Invariant: the user's real data (a directory
 * containing `praxrr.db`) is never deleted. Older `data.pre-restore-*` copies are pruned only
 * after a successful swap that itself produced a rollback containing a database, and never when
 * a lasting data-missing marker points at them.
 */

import {
  DATA_DIRNAME,
  DATABASE_FILENAME,
  describeError,
  RESTORE_MANIFEST_FILENAME,
  RESTORE_STAGING_DIRNAME,
  RESTORE_STAGING_TMP_PREFIX,
  type RestoreManifest,
} from './restore.ts';

export const RESTORE_FAILED_MANIFEST_FILENAME = 'manifest.failed.json';
/** Lasting marker (`{ rollbackPath }`) written when the real data only exists in a rollback copy. */
export const RESTORE_DATA_MISSING_MARKER = '.restore-data-missing';
const ROLLBACK_PREFIX = `${DATA_DIRNAME}.pre-restore-`;
/** Non-empty live `data/` without a database; set aside and never pruned. */
const NO_DATABASE_PREFIX = `${DATA_DIRNAME}.no-database-`;

export type ApplyRestoreResult =
  | { status: 'none' }
  | { status: 'applied'; filename: string; rollbackPath: string | null }
  | { status: 'failed'; error: string }
  /**
   * The real data exists only in `rollbackPath` (the swap and the move back both failed).
   * Startup must abort until the user moves it back to `data/`.
   */
  | { status: 'failed'; error: string; dataMissing: true; rollbackPath: string };

export interface RestoreLogger {
  info(message: string, meta?: Record<string, unknown>): void | Promise<void>;
  error(message: string, meta?: Record<string, unknown>): void | Promise<void>;
}

/** Filesystem seam so tests can inject rename failures. */
export interface ApplyRestoreDeps {
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Startup entry point. Skips the apply when the database is already open (Vite HMR re-evaluates
 * hooks with the connection still live), leaving the manifest for the next real restart.
 */
export async function applyPendingRestoreAtStartup(
  basePath: string,
  databaseOpen: boolean,
  log?: RestoreLogger
): Promise<ApplyRestoreResult | { status: 'skipped' }> {
  if (databaseOpen) {
    await log?.info('Database already open (hot reload); pending restores apply on next restart');
    return { status: 'skipped' };
  }
  return await applyPendingRestore(basePath, log);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

async function readManifest(path: string): Promise<RestoreManifest | null> {
  const parsed = await readJsonFile(path);
  if (parsed === null) return null;
  const manifest = parsed as Partial<RestoreManifest>;
  if (typeof manifest !== 'object' || typeof manifest.filename !== 'string' || typeof manifest.stagedAt !== 'string') {
    throw new Error('Restore manifest is malformed');
  }
  return manifest as RestoreManifest;
}

async function readDataMissingMarker(basePath: string): Promise<string | null> {
  const parsed = (await readJsonFile(`${basePath}/${RESTORE_DATA_MISSING_MARKER}`)) as {
    rollbackPath?: unknown;
  } | null;
  if (parsed === null) return null;
  if (typeof parsed.rollbackPath !== 'string') throw new Error('Data-missing marker is malformed');
  return parsed.rollbackPath;
}

async function writeDataMissingMarker(basePath: string, rollbackPath: string): Promise<void> {
  const markerPath = `${basePath}/${RESTORE_DATA_MISSING_MARKER}`;
  await Deno.writeTextFile(`${markerPath}.tmp`, JSON.stringify({ rollbackPath, writtenAt: new Date().toISOString() }));
  await Deno.rename(`${markerPath}.tmp`, markerPath);
}

async function isDirEmpty(path: string): Promise<boolean> {
  for await (const _entry of Deno.readDir(path)) return false;
  return true;
}

/** Delete `data.pre-restore-*` directories except `keepName` and the marker-protected path. */
async function pruneRollbacks(
  basePath: string,
  keepName: string,
  protectedPath: string | null,
  log?: RestoreLogger
): Promise<void> {
  for await (const entry of Deno.readDir(basePath)) {
    const path = `${basePath}/${entry.name}`;
    if (!entry.name.startsWith(ROLLBACK_PREFIX) || entry.name === keepName || path === protectedPath) continue;
    try {
      await Deno.remove(path, { recursive: true });
    } catch (error) {
      await log?.error('Failed to remove old pre-restore data copy', { path, error: describeError(error) });
    }
  }
}

/** Remove temp dirs left by staging attempts that were killed mid-way. */
async function removeStaleStagingTemps(basePath: string, log?: RestoreLogger): Promise<void> {
  for await (const entry of Deno.readDir(basePath)) {
    if (!entry.isDirectory || !entry.name.startsWith(RESTORE_STAGING_TMP_PREFIX)) continue;
    await Deno.remove(`${basePath}/${entry.name}`, { recursive: true }).catch(async (error) => {
      await log?.error('Failed to remove stale restore staging directory', {
        path: `${basePath}/${entry.name}`,
        error: describeError(error),
      });
    });
  }
}

/** Mark a staged restore as failed so it is never retried automatically. */
async function markRestoreFailed(stagingDir: string, log?: RestoreLogger): Promise<void> {
  try {
    await Deno.rename(
      `${stagingDir}/${RESTORE_MANIFEST_FILENAME}`,
      `${stagingDir}/${RESTORE_FAILED_MANIFEST_FILENAME}`
    );
  } catch (error) {
    await log?.error('Failed to mark staged restore as failed', { stagingDir, error: describeError(error) });
  }
}

async function safeLogError(log: RestoreLogger | undefined, message: string, meta: Record<string, unknown>) {
  try {
    await log?.error(message, meta);
  } catch {
    // Logging must never break startup
  }
}

function dataMissingResult(rollbackPath: string): ApplyRestoreResult {
  return {
    status: 'failed',
    error: `Data directory is missing after a failed restore; the previous data is preserved at ${rollbackPath}`,
    dataMissing: true,
    rollbackPath,
  };
}

/**
 * Apply a staged restore. Must run before the application database is opened.
 * Never throws: failures are logged and reported. A failed restore is marked
 * (`manifest.failed.json`) and never retried. If the real data ends up only in a rollback copy,
 * a lasting marker makes every later call report `dataMissing` until `data/praxrr.db` exists.
 */
export async function applyPendingRestore(
  basePath: string,
  log?: RestoreLogger,
  deps: ApplyRestoreDeps = {}
): Promise<ApplyRestoreResult> {
  const rename = deps.rename ?? Deno.rename;
  const stagingDir = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
  const stagedData = `${stagingDir}/extract/${DATA_DIRNAME}`;
  const liveData = `${basePath}/${DATA_DIRNAME}`;
  const liveDatabase = `${liveData}/${DATABASE_FILENAME}`;
  let manifestFound = false;

  try {
    await removeStaleStagingTemps(basePath, log);

    const markedRollback = await readDataMissingMarker(basePath);
    if (markedRollback !== null) {
      if (!(await pathExists(liveDatabase))) {
        await safeLogError(log, 'Data directory is still missing after a failed restore', {
          rollbackPath: markedRollback,
        });
        return dataMissingResult(markedRollback);
      }
      // The user moved the real data back into place
      await Deno.remove(`${basePath}/${RESTORE_DATA_MISSING_MARKER}`);
      await log?.info('Data directory recovered; cleared data-missing marker', { rollbackPath: markedRollback });
    }

    const manifest = await readManifest(`${stagingDir}/${RESTORE_MANIFEST_FILENAME}`);
    if (!manifest) return { status: 'none' };
    manifestFound = true;

    const stagedInfo = await Deno.lstat(stagedData).catch(() => null);
    if (!stagedInfo?.isDirectory) {
      const error = 'Staged restore data is missing; live data left unchanged';
      await log?.error(error, { filename: manifest.filename, stagingDir });
      await markRestoreFailed(stagingDir, log);
      return { status: 'failed', error };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rollbackName = `${ROLLBACK_PREFIX}${stamp}`;
    const rollbackPath = `${basePath}/${rollbackName}`;
    // Only a live data/ with a database is worth a rollback copy (an empty dir from config.init()
    // after an interrupted restore must never displace the real copy)
    const liveHasDatabase = await pathExists(liveDatabase);

    if (liveHasDatabase) {
      await rename(liveData, rollbackPath);
    } else if (await pathExists(liveData)) {
      if (await isDirEmpty(liveData)) {
        await Deno.remove(liveData);
      } else {
        const asidePath = `${basePath}/${NO_DATABASE_PREFIX}${stamp}`;
        await rename(liveData, asidePath);
        await log?.info('Moved live data directory without a database aside', { path: asidePath });
      }
    }

    try {
      await rename(stagedData, liveData);
    } catch (error) {
      await markRestoreFailed(stagingDir, log);
      if (liveHasDatabase) {
        try {
          await rename(rollbackPath, liveData);
        } catch (rollbackError) {
          await safeLogError(log, 'Restore failed and the previous data could not be moved back', {
            filename: manifest.filename,
            rollbackPath,
            error: describeError(error),
            rollbackError: describeError(rollbackError),
          });
          await writeDataMissingMarker(basePath, rollbackPath).catch(async (markerError) => {
            await safeLogError(log, 'Failed to write data-missing marker', {
              rollbackPath,
              error: describeError(markerError),
            });
          });
          return dataMissingResult(rollbackPath);
        }
      }
      const crossDevice = error instanceof Error && /EXDEV|cross-device/i.test(error.message);
      const message = crossDevice
        ? 'Restore staging is on a different filesystem than the data directory; live data left unchanged'
        : 'Failed to move staged restore data into place; live data left unchanged';
      await log?.error(message, { filename: manifest.filename, error: describeError(error) });
      return { status: 'failed', error: message };
    }

    await Deno.remove(stagingDir, { recursive: true }).catch(async (error) => {
      await log?.error('Failed to remove restore staging directory', { stagingDir, error: describeError(error) });
    });
    // Prune only after a successful swap whose new rollback holds a real database
    if (liveHasDatabase) {
      await pruneRollbacks(basePath, rollbackName, markedRollback, log);
    }

    const keptRollback = liveHasDatabase ? rollbackPath : null;
    await log?.info('Applied staged backup restore', {
      filename: manifest.filename,
      stagedAt: manifest.stagedAt,
      rollbackPath: keptRollback,
    });
    return { status: 'applied', filename: manifest.filename, rollbackPath: keptRollback };
  } catch (error) {
    const message = `Failed to apply staged restore: ${describeError(error)}`;
    await safeLogError(log, message, { stagingDir });
    if (manifestFound) await markRestoreFailed(stagingDir, log).catch(() => {});
    return { status: 'failed', error: message };
  }
}
