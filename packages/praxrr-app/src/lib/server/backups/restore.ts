/**
 * Staged backup restore.
 *
 * Restoring by extracting over the live, open WAL database corrupts it, so restores are split:
 * 1. `stageRestore` validates the archive in a private `.restore-staging-tmp-*` directory, writes
 *    `manifest.json` there, then renames the whole directory onto `<base>/.restore-staging`.
 * 2. `applyPendingRestore` runs at startup before the database is opened and swaps the staged
 *    `data/` directory in, keeping the previous `data/` as a rollback copy.
 *
 * Paths are passed in so this module stays free of config/database dependencies.
 */

export const RESTORE_STAGING_DIRNAME = '.restore-staging';
export const RESTORE_STAGING_TMP_PREFIX = '.restore-staging-tmp-';
export const RESTORE_MANIFEST_FILENAME = 'manifest.json';
export const RESTORE_FAILED_MANIFEST_FILENAME = 'manifest.failed.json';
const DATA_DIRNAME = 'data';
const DATABASE_MEMBER = `${DATA_DIRNAME}/praxrr.db`;
const ROLLBACK_PREFIX = `${DATA_DIRNAME}.pre-restore-`;
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type BackupRestoreErrorCode =
  'invalid_archive' | 'unsafe_member' | 'unsafe_entry' | 'missing_database' | 'invalid_database' | 'staging_failed';

/** Restore validation/staging failure. `message` is safe to show to users; `detail` is for logs. */
export class BackupRestoreError extends Error {
  constructor(
    readonly code: BackupRestoreErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = 'BackupRestoreError';
  }
}

export interface RestoreManifest {
  filename: string;
  stagedAt: string;
}

export interface StageRestoreOptions {
  archivePath: string;
  basePath: string;
  filename: string;
}

export type ApplyRestoreResult =
  | { status: 'none' }
  | { status: 'applied'; filename: string; rollbackPath: string | null }
  | { status: 'failed'; error: string }
  /** Neither the staged nor the previous data could be moved back into place; startup must abort. */
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
 * Backup filenames are flat names `backup-*.tar.gz` (spaces and other printable characters
 * allowed, e.g. browser-renamed `backup-x (1).tar.gz`) without path separators, `..`, or
 * control characters.
 */
export function isValidBackupFilename(name: string): boolean {
  return (
    name.startsWith('backup-') &&
    name.endsWith('.tar.gz') &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..') &&
    !CONTROL_CHARACTER_PATTERN.test(name)
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function runTar(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await new Deno.Command('tar', {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const decoder = new TextDecoder();
  return { code, stdout: decoder.decode(stdout), stderr: decoder.decode(stderr) };
}

/**
 * Members must be `data` or live under `data/`, be relative, and contain no `..` segment.
 * Names are compared as listed by tar (which may escape non-ASCII bytes); links and special
 * files are rejected after extraction by `validateExtractedTree`.
 */
function validateMembers(members: string[]): void {
  for (const member of members) {
    const segments = member.split('/');
    const unsafe = member.startsWith('/') || segments.includes('..') || segments[0] !== DATA_DIRNAME;
    if (unsafe) {
      throw new BackupRestoreError(
        'unsafe_member',
        'Backup archive contains files outside the data directory',
        `Unsafe archive member: ${member}`
      );
    }
  }
  if (!members.includes(DATABASE_MEMBER)) {
    throw new BackupRestoreError('missing_database', 'Backup archive does not contain data/praxrr.db');
  }
}

/** Reject anything in the extracted tree that is not a plain file or directory. */
async function validateExtractedTree(dir: string): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    const info = await Deno.lstat(path);
    if (info.isDirectory) {
      await validateExtractedTree(path);
    } else if (!info.isFile) {
      throw new BackupRestoreError(
        'unsafe_entry',
        'Backup archive contains links or special files',
        `Unsupported entry type: ${path}`
      );
    }
  }
}

async function validateSqliteHeader(path: string): Promise<void> {
  const info = await Deno.lstat(path);
  if (!info.isFile) {
    throw new BackupRestoreError('missing_database', 'Backup archive does not contain data/praxrr.db');
  }
  const file = await Deno.open(path, { read: true });
  try {
    const header = new Uint8Array(SQLITE_HEADER.length);
    let offset = 0;
    while (offset < header.length) {
      const read = await file.read(header.subarray(offset));
      if (read === null) break;
      offset += read;
    }
    const matches = offset === header.length && header.every((byte, index) => byte === SQLITE_HEADER[index]);
    if (!matches) {
      throw new BackupRestoreError('invalid_database', 'Backup database is not a valid SQLite file');
    }
  } finally {
    file.close();
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Replace `<base>/.restore-staging` with the fully validated temp dir. Retries if a concurrent stage wins. */
async function publishStaging(tempDir: string, stagingDir: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await removeIfExists(stagingDir);
    try {
      await Deno.rename(tempDir, stagingDir);
      return;
    } catch (error) {
      // Another stage published between our remove and rename (non-empty target dir)
      if (attempt >= 3) throw error;
    }
  }
}

/**
 * Validate a backup archive and stage it for restore at next startup.
 * Never touches `<basePath>/data` or an already staged restore until the new one is fully
 * validated. On failure only this call's temp directory is removed and a `BackupRestoreError`
 * is thrown.
 */
export async function stageRestore({ archivePath, basePath, filename }: StageRestoreOptions): Promise<RestoreManifest> {
  const stagingDir = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
  let tempDir: string | null = null;

  try {
    const listing = await runTar(['-tzf', archivePath]);
    if (listing.code !== 0) {
      throw new BackupRestoreError('invalid_archive', 'Backup archive could not be read', listing.stderr.trim());
    }
    const members = listing.stdout
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^\.\//, '').replace(/\/+$/, ''));
    if (members.length === 0) {
      throw new BackupRestoreError('invalid_archive', 'Backup archive is empty');
    }
    validateMembers(members);

    tempDir = await Deno.makeTempDir({ dir: basePath, prefix: RESTORE_STAGING_TMP_PREFIX });
    const extractDir = `${tempDir}/extract`;
    await Deno.mkdir(extractDir);

    const extraction = await runTar(['-xzf', archivePath, '-C', extractDir]);
    if (extraction.code !== 0) {
      throw new BackupRestoreError(
        'invalid_archive',
        'Backup archive could not be extracted',
        extraction.stderr.trim()
      );
    }

    await validateExtractedTree(extractDir);
    await validateSqliteHeader(`${extractDir}/${DATABASE_MEMBER}`);

    const manifest: RestoreManifest = { filename, stagedAt: new Date().toISOString() };
    await Deno.writeTextFile(`${tempDir}/${RESTORE_MANIFEST_FILENAME}`, JSON.stringify(manifest));

    // Publishing the complete directory is the final step, so a partial stage is never visible
    await publishStaging(tempDir, stagingDir);
    tempDir = null;
    return manifest;
  } catch (error) {
    if (tempDir) await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    if (error instanceof BackupRestoreError) throw error;
    throw new BackupRestoreError('staging_failed', 'Failed to stage backup for restore', describeError(error));
  }
}

async function readManifest(path: string): Promise<RestoreManifest | null> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as RestoreManifest).filename !== 'string' ||
    typeof (parsed as RestoreManifest).stagedAt !== 'string'
  ) {
    throw new Error('Restore manifest is malformed');
  }
  return parsed as RestoreManifest;
}

/** Delete every `data.pre-restore-*` directory except `keepName`. */
async function pruneRollbacks(basePath: string, keepName: string, log?: RestoreLogger): Promise<void> {
  for await (const entry of Deno.readDir(basePath)) {
    if (!entry.name.startsWith(ROLLBACK_PREFIX) || entry.name === keepName) continue;
    try {
      await Deno.remove(`${basePath}/${entry.name}`, { recursive: true });
    } catch (error) {
      await log?.error('Failed to remove old pre-restore data copy', {
        path: `${basePath}/${entry.name}`,
        error: describeError(error),
      });
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

/**
 * Apply a staged restore. Must run before the application database is opened.
 * Never throws: failures are logged and reported. A failed restore is marked
 * (`manifest.failed.json`) and never retried. Live data stays in place unless both the swap and
 * the move back failed, which is reported as `dataMissing` so the caller can abort startup.
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
  let manifestFound = false;

  try {
    await removeStaleStagingTemps(basePath, log);

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

    const rollbackName = `${ROLLBACK_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const rollbackPath = `${basePath}/${rollbackName}`;
    const hadLiveData = await pathExists(liveData);

    if (hadLiveData) {
      await rename(liveData, rollbackPath);
    }

    try {
      await rename(stagedData, liveData);
    } catch (error) {
      await markRestoreFailed(stagingDir, log);
      if (hadLiveData) {
        try {
          await rename(rollbackPath, liveData);
        } catch (rollbackError) {
          const message = `Restore failed and the previous data could not be moved back; it is preserved at ${rollbackPath}`;
          await safeLogError(log, message, {
            filename: manifest.filename,
            rollbackPath,
            error: describeError(error),
            rollbackError: describeError(rollbackError),
          });
          return { status: 'failed', error: message, dataMissing: true, rollbackPath };
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
    // Only prune older rollback copies after a successful swap
    if (hadLiveData) {
      await pruneRollbacks(basePath, rollbackName, log);
    }

    await log?.info('Applied staged backup restore', {
      filename: manifest.filename,
      stagedAt: manifest.stagedAt,
      rollbackPath: hadLiveData ? rollbackPath : null,
    });
    return { status: 'applied', filename: manifest.filename, rollbackPath: hadLiveData ? rollbackPath : null };
  } catch (error) {
    const message = `Failed to apply staged restore: ${describeError(error)}`;
    await safeLogError(log, message, { stagingDir });
    if (manifestFound) await markRestoreFailed(stagingDir, log).catch(() => {});
    return { status: 'failed', error: message };
  }
}
