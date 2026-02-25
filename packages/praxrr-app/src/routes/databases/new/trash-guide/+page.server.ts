import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { trashGuideManager } from '$lib/server/trashguide/index.ts';
import { TrashGuideSourceConflictError, TrashGuideSourceValidationError } from '$lib/server/trashguide/manager.ts';
import { logger } from '$logger/logger.ts';

export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();

    const name = formData.get('name')?.toString().trim() || '';
    const arrType = formData.get('arr_type')?.toString().trim() || '';
    const repositoryUrl = formData.get('repository_url')?.toString().trim() || '';
    const branch = formData.get('branch')?.toString().trim() || 'master';
    const scoreProfile = formData.get('score_profile')?.toString().trim() || 'default';
    const syncStrategy = parseInt(formData.get('sync_strategy')?.toString() || '60', 10);
    const autoPull = formData.get('auto_pull') === '1';

    if (!name) {
      return fail(400, { error: 'Name is required' });
    }

    if (!arrType || (arrType !== 'radarr' && arrType !== 'sonarr')) {
      return fail(422, { error: 'Arr type must be radarr or sonarr' });
    }

    try {
      await trashGuideManager.createSource({
        name,
        repositoryUrl,
        branch,
        arrType,
        scoreProfile,
        syncStrategy,
        autoPull,
        enabled: true,
      });

      await logger.info(`Added TRaSH Guide source: ${name}`, {
        source: 'databases/new/trash-guide',
        meta: { name, arrType, scoreProfile },
      });

      redirect(303, '/databases');
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
        throw error;
      }

      if (error instanceof TrashGuideSourceConflictError) {
        return fail(400, {
          error:
            error.conflictField === 'name'
              ? 'A source with this name already exists'
              : 'A TRaSH Guide source for this Arr type already exists',
        });
      }

      if (error instanceof TrashGuideSourceValidationError) {
        return fail(422, { error: error.message });
      }

      await logger.error('Failed to add TRaSH Guide source', {
        source: 'databases/new/trash-guide',
        meta: {
          error: error instanceof Error ? error.message : String(error),
          name,
          arrType,
        },
      });

      return fail(500, {
        error: error instanceof Error ? error.message : 'Failed to add TRaSH Guide source',
      });
    }
  },
} satisfies Actions;
