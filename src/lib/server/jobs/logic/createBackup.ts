/**
 * Core backup creation logic
 * Separated from job definition to avoid database/config dependencies for testing
 */

export interface CreateBackupResult {
  success: boolean;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

/**
 * Core backup logic - creates a tar.gz archive of a directory
 * Pure function that only depends on Deno APIs
 *
 * @param sourceDir Directory to backup (will backup this entire directory)
 * @param backupDir Directory where backup file will be saved
 * @param timestamp Optional timestamp for backup filename (defaults to current time)
 * @returns Backup result with filename and size or error
 */
export async function createBackup(
  sourceDir: string,
  backupDir: string,
  timestamp?: Date
): Promise<CreateBackupResult> {
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
        error: `Failed to create backup directory: ${error instanceof Error ? error.message : String(error)}`,
      };
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
    } catch (_error) {
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

    // Create tar.gz archive
    const command = new Deno.Command('tar', {
      args: ['-czf', backupPath, '-C', parentDir, dirName],
      stdout: 'piped',
      stderr: 'piped',
    });

    const { code, stderr } = await command.output();

    if (code !== 0) {
      const errorMessage = new TextDecoder().decode(stderr);
      return {
        success: false,
        error: `tar command failed with code ${code}: ${errorMessage}`,
      };
    }

    // Get backup file size
    const stat = await Deno.stat(backupPath);

    return {
      success: true,
      filename: backupFilename,
      sizeBytes: stat.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
