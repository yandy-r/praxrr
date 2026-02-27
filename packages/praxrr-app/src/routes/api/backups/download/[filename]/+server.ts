import { error, type RequestHandler } from '@sveltejs/kit';
import { config } from '$config';

/**
 * GET /api/backups/download/{filename}
 *
 * Stream a generated backup tarball for download.
 * Filename must match `backup-*.tar.gz`; otherwise returns 400.
 */
export const GET: RequestHandler = async ({ params }) => {
  const { filename } = params;

  // Validate filename
  if (!filename || !filename.startsWith('backup-') || !filename.endsWith('.tar.gz')) {
    throw error(400, 'Invalid filename');
  }

  const backupPath = `${config.paths.backups}/${filename}`;

  try {
    // Check if file exists
    await Deno.stat(backupPath);

    // Read the file
    const file = await Deno.readFile(backupPath);

    // Return file as download
    return new Response(file, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (_err) {
    throw error(404, 'Backup file not found');
  }
};
