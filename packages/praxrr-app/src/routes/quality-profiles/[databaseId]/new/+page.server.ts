import { error, redirect, fail } from '@sveltejs/kit';
import type { ServerLoad, Actions } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import { getRadarrLanguages } from '$lib/server/sync/mappings.ts';
import { parseOperationLayer } from '$pcd/index.ts';
import { ARR_APP_TYPES, type ArrAppType } from '$shared/arr/capabilities.ts';

export const load: ServerLoad = ({ params }) => {
  const { databaseId } = params;

  if (!databaseId) {
    throw error(400, 'Missing database ID');
  }

  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  const currentDatabase = pcdManager.getById(currentDatabaseId);
  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  // Get Radarr languages (language field is Radarr-only)
  const availableLanguages = getRadarrLanguages();

  return {
    currentDatabase,
    availableLanguages,
    canWriteToBase: canWriteToBase(currentDatabaseId),
  };
};

export const actions: Actions = {
  default: async ({ request, params, url }) => {
    const { databaseId } = params;

    if (!databaseId) {
      return fail(400, { error: 'Missing database ID' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const formData = await request.formData();

    // Parse form data
    const name = formData.get('name') as string;
    const description = (formData.get('description') as string) || null;
    const tagsJson = formData.get('tags') as string;
    const languageRaw = formData.get('language') as string;
    const language = languageRaw && languageRaw.trim() !== '' ? languageRaw.trim() : null;
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

    // Target Arr app for the seeded quality ladder (`?arrType=` on the action URL, set by the page's
    // selector); empty infers Radarr + Sonarr (video).
    const arrTypeRaw = (url.searchParams.get('arrType') ?? '').trim();
    if (arrTypeRaw && !(ARR_APP_TYPES as readonly string[]).includes(arrTypeRaw)) {
      return fail(400, { error: 'Invalid target Arr app' });
    }
    const arrType = arrTypeRaw ? (arrTypeRaw as ArrAppType) : undefined;

    // Validate
    if (!name?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    // Duplicate name checks are enforced at the entity layer.

    let tags: string[] = [];
    try {
      tags = JSON.parse(tagsJson || '[]');
    } catch {
      return fail(400, { error: 'Invalid tags format' });
    }

    // Check layer permission
    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    // Create the quality profile
    let result;
    try {
      result = await qualityProfileQueries.create({
        databaseId: currentDatabaseId,
        cache,
        layer,
        input: {
          name: name.trim(),
          description: description?.trim() || null,
          tags,
          language,
          arrType,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create quality profile';
      if (message.includes('already exists')) {
        return fail(400, { error: message });
      }
      return fail(500, { error: message });
    }

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to create quality profile' });
    }

    // Get fresh cache after create (compile creates a new cache instance)
    const freshCache = pcdManager.getCache(currentDatabaseId);
    if (!freshCache) {
      // Fallback to list page if cache isn't ready
      throw redirect(303, `/quality-profiles/${databaseId}`);
    }

    // Get the new profile ID by looking it up by name
    const profiles = await qualityProfileQueries.list(freshCache);
    const newProfile = profiles.find((p) => p.name === name.trim());

    if (newProfile) {
      // Redirect to scoring page so user can configure custom format scores
      throw redirect(303, `/quality-profiles/${databaseId}/${newProfile.id}/scoring`);
    }

    // Fallback to list page if we can't find the new profile
    throw redirect(303, `/quality-profiles/${databaseId}`);
  },
};
