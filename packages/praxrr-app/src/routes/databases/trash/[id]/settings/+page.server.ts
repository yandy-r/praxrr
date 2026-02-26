import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { trashGuideManager } from '$lib/server/trashguide/index.ts';
import {
  TrashGuideSourceConflictError,
  TrashGuideSourceNotFoundError,
  TrashGuideSourceValidationError,
} from '$lib/server/trashguide/manager.ts';
import { logger } from '$logger/logger.ts';

export const actions = {
  update: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid source ID' });
    }

    const formData = await request.formData();
    const name = formData.get('name')?.toString().trim();
    const scoreProfile = formData.get('score_profile')?.toString().trim();
    const syncStrategy = formData.get('sync_strategy')?.toString().trim();
    const autoPullValue = formData.get('auto_pull')?.toString();
    const autoPull = autoPullValue === undefined ? undefined : autoPullValue === '1';

    if (name !== undefined && !name) {
      return fail(400, { error: 'Name is required' });
    }

    try {
      await trashGuideManager.updateSource(id, {
        ...(name !== undefined ? { name } : {}),
        ...(scoreProfile !== undefined ? { scoreProfile } : {}),
        ...(syncStrategy !== undefined ? { syncStrategy: parseInt(syncStrategy, 10) } : {}),
        ...(autoPullValue !== undefined ? { autoPull } : {}),
      });

      await logger.info(`Updated TRaSH source settings: ${id}`, {
        source: 'databases/trash/settings',
        meta: { id, name, scoreProfile, syncStrategy },
      });

      return { success: true };
    } catch (error) {
      if (error instanceof TrashGuideSourceNotFoundError) {
        return fail(404, { error: 'Source not found' });
      }
      if (error instanceof TrashGuideSourceConflictError) {
        return fail(400, { error: 'A source with this name already exists' });
      }
      if (error instanceof TrashGuideSourceValidationError) {
        return fail(422, { error: error.message });
      }

      await logger.error('Failed to update TRaSH source', {
        source: 'databases/trash/settings',
        meta: { id, error: error instanceof Error ? error.message : String(error) },
      });

      return fail(500, {
        error: error instanceof Error ? error.message : 'Failed to update source',
      });
    }
  },

  delete: async ({ params }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid source ID' });
    }

    try {
      await trashGuideManager.deleteSource(id);

      await logger.info(`Deleted TRaSH source: ${id}`, {
        source: 'databases/trash/settings',
        meta: { id },
      });

      redirect(303, '/databases');
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
        throw error;
      }

      await logger.error('Failed to delete TRaSH source', {
        source: 'databases/trash/settings',
        meta: { id, error: error instanceof Error ? error.message : String(error) },
      });

      return fail(500, {
        error: error instanceof Error ? error.message : 'Failed to delete source',
      });
    }
  },
} satisfies Actions;
