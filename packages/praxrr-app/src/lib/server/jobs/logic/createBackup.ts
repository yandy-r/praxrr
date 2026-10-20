/**
 * Core backup creation logic
 * Separated from job definition to avoid database/config dependencies for testing
 */

export interface CreateBackupResult {
  success: boolean;
  filename?: string;
  sizeBytes?: number;
  error?: string;
  /** Non-fatal tar warning (e.g. a non-database file changed while archiving) */
  warning?: string;
}

export interface CreateBackupOptions {
  /** Database filename inside sourceDir that is replaced by the snapshot (default `praxrr.db`) */
  databaseFilename?: string;
  /**
   * Write a consistent snapshot of the live database to `destPath` (which must not exist yet).
   * When provided, the live database file and its `-wal`/`-shm`/`-journal` siblings are excluded
   * from the archive and the snapshot is archived in their place.
   */
  snapshotDatabase?: (destPath: string) => void | Promise<void>;
}

export type TarExitClassification = { ok: true; warning?: string } | { ok: false; error: string };

const FILE_CHANGED_PATTERN = /file changed as we read it/;
export const BACKUP_STAGING_PREFIX = '.backup-staging-';

/**
 * Classify a tar exit status.
 * GNU tar exits 1 when a file changed while being read; the archive is still complete, so that
 * case is reported as success with a warning. Every other non-zero status is a failure.
 */
export function classifyTarExit(code: number, stderr: string): TarExitClassification {
  const message = stderr.trim();
  if (code === 0) {
    return message.length > 0 ? { ok: true, warning: message } : { ok: true };
  }
  if (code === 1 && FILE_CHANGED_PATTERN.test(message)) {
    return { ok: true, warning: message };
  }
  return { ok: false, error: `tar command failed with code ${code}: ${message}` };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Core backup logic - creates a tar.gz archive of a directory
 * Pure function that only depends on Deno APIs
 *
 * @param sourceDir Directory to backup (will backup this entire directory)
 * @param backupDir Directory where backup file will be saved
 * @param timestamp Optional timestamp for backup filename (defaults to current time)
 * @param options Optional database snapshot hook
 * @returns Backup result with filename and size or error
 */
export async function createBackup(
  sourceDir: string,
  backupDir: string,
  timestamp?: Date,
  options?: CreateBackupOptions
): Promise<CreateBackupResult> {
  let stagingDir: string | null = null;
  try {
    // Generate backup filename with timestamp
    const now = timestamp ?? new Date();
    const datePart = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timePart = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, ''); // HHMMSS
    const backupFilename = `backup-${datePart}-${timePart}.tar.gz`;
    const backupPath = `${backupDir}/${backupFilename}`;

    // Ensure backup directory exists
    try {
      await Deno.mkdir(backupDir, { recursive: true });
    } catch (error) {
      return {
        success: false,
        error: `Failed to create backup directory: ${errorMessage(error)}`,
      };
    }

    // Remove snapshot staging dirs left behind by a backup process that was killed mid-run
    for await (const entry of Deno.readDir(backupDir)) {
      if (entry.isDirectory && entry.name.startsWith(BACKUP_STAGING_PREFIX)) {
        await Deno.remove(`${backupDir}/${entry.name}`, { recursive: true }).catch(() => {});
      }
    }

    // Verify source directory exists
    try {
      const stat = await Deno.stat(sourceDir);
      if (!stat.isDirectory) {
        return {
          success: false,
          error: `Source path is not a directory: ${sourceDir}`,
        };
      }
    } catch {
      return {
        success: false,
        error: `Source directory does not exist: ${sourceDir}`,
      };
    }

    // Get parent directory and directory name for tar command
    const isAbsolute = sourceDir.startsWith('/');
    const sourcePathParts = sourceDir.split('/').filter((p) => p);
    const dirName = sourcePathParts[sourcePathParts.length - 1];
    const parentDirParts = sourcePathParts.slice(0, -1);
    const parentDir = parentDirParts.length > 0 ? (isAbsolute ? '/' : '') + parentDirParts.join('/') : '/';

    let tarArgs = ['-czf', backupPath, '-C', parentDir, dirName];

    if (options?.snapshotDatabase) {
      const databaseFilename = options.databaseFilename ?? 'praxrr.db';
      stagingDir = await Deno.makeTempDir({ dir: backupDir, prefix: BACKUP_STAGING_PREFIX });
      await Deno.mkdir(`${stagingDir}/${dirName}`);

      try {
        await options.snapshotDatabase(`${stagingDir}/${dirName}/${databaseFilename}`);
      } catch (error) {
        return { success: false, error: `Database snapshot failed: ${errorMessage(error)}` };
      }

      // Archive every live entry except the database and its sidecar files, then the snapshot
      const excluded = new Set(['', '-wal', '-shm', '-journal'].map((suffix) => `${databaseFilename}${suffix}`));
      const liveEntries: string[] = [];
      for await (const entry of Deno.readDir(sourceDir)) {
        if (!excluded.has(entry.name)) liveEntries.push(`${dirName}/${entry.name}`);
      }
      liveEntries.sort();

      tarArgs = [
        '-czf',
        backupPath,
        '-C',
        parentDir,
        ...liveEntries,
        '-C',
        stagingDir,
        `${dirName}/${databaseFilename}`,
      ];
    }

    // Create tar.gz archive
    const command = new Deno.Command('tar', {
      args: tarArgs,
      stdout: 'piped',
      stderr: 'piped',
    });

    const { code, stderr } = await command.output();
    const classification = classifyTarExit(code, new TextDecoder().decode(stderr));

    if (!classification.ok) {
      await Deno.remove(backupPath).catch(() => {});
      return {
        success: false,
        error: classification.error,
      };
    }

    // Get backup file size
    const stat = await Deno.stat(backupPath);

    return {
      success: true,
      filename: backupFilename,
      sizeBytes: stat.size,
      ...(classification.warning ? { warning: classification.warning } : {}),
    };
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
    };
  } finally {
    if (stagingDir) {
      await Deno.remove(stagingDir, { recursive: true }).catch(() => {});
    }
  }
}
