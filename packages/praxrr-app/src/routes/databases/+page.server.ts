import { fail, redirect } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { pcdManager, getCache } from '$pcd/index.ts';
import { trashGuideManager } from '$lib/server/trashguide/index.ts';
import { logger } from '$logger/logger.ts';

export const load: ServerLoad = () => {
  const databases = pcdManager.getAll().map((database) => {
    const { personal_access_token: _redactedToken, ...databaseWithoutToken } = database;
    return {
      ...databaseWithoutToken,
      personal_access_token: '',
      cacheAvailable: !!getCache(database.id),
    };
  });

  const trashSources = trashGuideManager.listSources();

  return {
    databases,
    trashSources,
  };
};

export const actions = {
  delete: async ({ request }) => {
    const formData = await request.formData();
    const id = parseInt(formData.get('id')?.toString() || '0', 10);

    if (!id) {
      await logger.warn('Attempted to unlink database without ID', {
        source: 'databases',
      });

      return fail(400, {
        error: 'Database ID is required',
      });
    }

    try {
      await pcdManager.unlink(id);

      await logger.info(`Unlinked database: ${id}`, {
        source: 'databases',
        meta: { id },
      });

      redirect(303, '/databases');
    } catch (error) {
      // Re-throw redirect errors (they're not actual errors)
      if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
        throw error;
      }

      await logger.error('Failed to unlink database', {
        source: 'databases',
        meta: { error: error instanceof Error ? error.message : String(error) },
      });

      return fail(500, {
        error: error instanceof Error ? error.message : 'Failed to unlink database',
      });
    }
  },

  deleteTrash: async ({ request }) => {
    const formData = await request.formData();
    const id = parseInt(formData.get('id')?.toString() || '0', 10);

    if (!id) {
      await logger.warn('Attempted to unlink TRaSH source without ID', {
        source: 'databases',
      });

      return fail(400, {
        error: 'Source ID is required',
      });
    }

    try {
      await trashGuideManager.deleteSource(id);

      await logger.info(`Unlinked TRaSH source: ${id}`, {
        source: 'databases',
        meta: { id },
      });

      redirect(303, '/databases');
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
        throw error;
      }

      await logger.error('Failed to unlink TRaSH source', {
        source: 'databases',
        meta: { error: error instanceof Error ? error.message : String(error) },
      });

      return fail(500, {
        error: error instanceof Error ? error.message : 'Failed to unlink TRaSH source',
      });
    }
  },
} satisfies Actions;
