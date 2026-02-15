import type { Actions, RequestEvent } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { enqueueJob } from '$lib/server/jobs/queueService.ts';
import { buildJobDisplayName } from '$lib/server/jobs/display.ts';

interface BackupFile {
  filename: string;
  created: Date;
  size: number;
  sizeFormatted: string;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const load = async () => {
  const backupsDir = config.paths.backups;
  const backups: BackupFile[] = [];

  try {
    for await (const entry of Deno.readDir(backupsDir)) {
      if (!entry.isFile) continue;
      if (!entry.name.startsWith('backup-') || !entry.name.endsWith('.tar.gz')) {
        continue;
      }

      const filePath = `${backupsDir}/${entry.name}`;
      const stat = await Deno.stat(filePath);

      backups.push({
        filename: entry.name,
        created: stat.mtime || new Date(),
        size: stat.size,
        sizeFormatted: formatFileSize(stat.size),
      });
    }
  } catch (err) {
    await logger.error('Failed to list backups', {
      source: 'settings/backups',
      meta: { error: err },
    });
  }

  // Sort by creation date (newest first)
  backups.sort((a, b) => b.created.getTime() - a.created.getTime());

  return {
    backups,
  };
};

export const actions: Actions = {
  createBackup: async () => {
    try {
      const queued = enqueueJob({
        jobType: 'backup.create',
        runAt: new Date().toISOString(),
        payload: {},
        source: 'manual',
      });

      await logger.info('Manual backup creation queued', {
        source: 'settings/backups',
        meta: {
          jobId: queued.id,
          displayName: buildJobDisplayName('backup.create', {}),
        },
      });

      return { success: true, message: 'Backup queued' };
    } catch (err) {
      await logger.error('Failed to trigger backup', {
        source: 'settings/backups',
        meta: { error: err },
      });
      return fail(500, { error: 'Failed to trigger backup' });
    }
  },

  cleanupBackups: async () => {
    try {
      const queued = enqueueJob({
        jobType: 'backup.cleanup',
        runAt: new Date().toISOString(),
        payload: {},
        source: 'manual',
      });

      await logger.info('Manual backup cleanup queued', {
        source: 'settings/backups',
        meta: {
          jobId: queued.id,
          displayName: buildJobDisplayName('backup.cleanup', {}),
        },
      });

      return { success: true, message: 'Backup cleanup queued' };
    } catch (err) {
      await logger.error('Failed to trigger backup cleanup', {
        source: 'settings/backups',
        meta: { error: err },
      });
      return fail(500, { error: 'Failed to trigger backup cleanup' });
    }
  },

  uploadBackup: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return fail(400, { error: 'No file provided' });
    }

    // Validate filename
    if (!file.name.endsWith('.tar.gz')) {
      return fail(400, { error: 'Invalid file type. Only .tar.gz files are allowed.' });
    }

    // Validate file size (max 1GB)
    const maxSize = 1024 * 1024 * 1024; // 1GB
    if (file.size > maxSize) {
      return fail(400, { error: 'File too large. Maximum size is 1GB.' });
    }

    try {
      const backupsDir = config.paths.backups;
      const filename = file.name.startsWith('backup-') ? file.name : `backup-uploaded-${Date.now()}.tar.gz`;
      const backupPath = `${backupsDir}/${filename}`;

      // Check if file already exists
      try {
        await Deno.stat(backupPath);
        return fail(400, { error: 'A backup with this name already exists' });
      } catch {
        // File doesn't exist, which is what we want
      }

      // Write the file
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      await Deno.writeFile(backupPath, uint8Array);

      await logger.info(`Uploaded backup: ${filename}`, {
        source: 'settings/backups',
        meta: { filename, size: file.size },
      });

      return { success: true };
    } catch (err) {
      await logger.error('Failed to upload backup', {
        source: 'settings/backups',
        meta: { error: err },
      });
      return fail(500, { error: 'Failed to upload backup' });
    }
  },

  deleteBackup: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const filename = formData.get('filename') as string;

    if (!filename || !filename.startsWith('backup-') || !filename.endsWith('.tar.gz')) {
      return fail(400, { error: 'Invalid filename' });
    }

    const backupPath = `${config.paths.backups}/${filename}`;

    try {
      await Deno.remove(backupPath);

      await logger.info(`Deleted backup: ${filename}`, {
        source: 'settings/backups',
        meta: { filename },
      });

      return { success: true };
    } catch (err) {
      await logger.error(`Failed to delete backup: ${filename}`, {
        source: 'settings/backups',
        meta: { filename, error: err },
      });
      return fail(500, { error: 'Failed to delete backup' });
    }
  },

  restoreBackup: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const filename = formData.get('filename') as string;

    if (!filename || !filename.startsWith('backup-') || !filename.endsWith('.tar.gz')) {
      return fail(400, { error: 'Invalid filename' });
    }

    const backupPath = `${config.paths.backups}/${filename}`;

    try {
      // Verify backup exists
      await Deno.stat(backupPath);

      await logger.warn(`Restoring from backup: ${filename}`, {
        source: 'settings/backups',
        meta: { filename },
      });

      // Extract backup to base directory (will overwrite data directory)
      const command = new Deno.Command('tar', {
        args: ['-xzf', backupPath, '-C', config.paths.base],
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stderr } = await command.output();

      if (code !== 0) {
        const errorMessage = new TextDecoder().decode(stderr);
        await logger.error('Backup restoration failed', {
          source: 'settings/backups',
          meta: { filename, error: errorMessage, exitCode: code },
        });
        return fail(500, { error: `Restore failed: ${errorMessage}` });
      }

      await logger.info(`Successfully restored from backup: ${filename}`, {
        source: 'settings/backups',
        meta: { filename },
      });

      return {
        success: true,
        message: 'Backup restored successfully. Please restart the application.',
      };
    } catch (err) {
      await logger.error(`Failed to restore backup: ${filename}`, {
        source: 'settings/backups',
        meta: { filename, error: err },
      });
      return fail(500, { error: 'Failed to restore backup' });
    }
  },
};
