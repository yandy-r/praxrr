import { error, redirect, fail } from '@sveltejs/kit';
import type { ServerLoad, Actions } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import * as customFormatQueries from '$pcd/entities/customFormats/index.ts';
import { loadSectionTiers } from '$lib/server/complexity/loadSectionTiers.ts';
import { loadSectionModes } from '$lib/server/disclosure/loadSectionModes.ts';
import { CUSTOM_FORMAT_KEYS } from '$shared/disclosure/sectionKeys.ts';
import { parseOperationLayer } from '$pcd/index.ts';

export const load: ServerLoad = async ({ params, locals }) => {
  const { databaseId, id } = params;

  // Validate params exist
  if (!databaseId || !id) {
    throw error(400, 'Missing required parameters');
  }

  // Parse and validate the database ID
  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  // Parse and validate the format ID
  const formatId = parseInt(id, 10);
  if (isNaN(formatId)) {
    throw error(400, 'Invalid format ID');
  }

  // Get current database
  const currentDatabase = pcdManager.getById(currentDatabaseId);
  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  // Get the cache for the database
  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(500, 'Database cache not available');
  }

  // Load general information for the custom format
  const format = await customFormatQueries.general(cache, formatId);
  if (!format) {
    throw error(404, 'Custom format not found');
  }

  const customFormatSectionModes = loadSectionModes(locals.user?.id, CUSTOM_FORMAT_KEYS);
  const customFormatSectionTiers = loadSectionTiers(locals.user?.id, CUSTOM_FORMAT_KEYS);

  return {
    currentDatabase,
    format,
    canWriteToBase: canWriteToBase(currentDatabaseId),
    customFormatSectionModes,
    customFormatSectionTiers,
  };
};

export const actions: Actions = {
  update: async ({ request, params }) => {
    const { databaseId, id } = params;

    if (!databaseId || !id) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    const formatId = parseInt(id, 10);

    if (isNaN(currentDatabaseId) || isNaN(formatId)) {
      return fail(400, { error: 'Invalid parameters' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    // Get current format for value guards
    const current = await customFormatQueries.general(cache, formatId);
    if (!current) {
      return fail(404, { error: 'Custom format not found' });
    }

    const formData = await request.formData();

    // Parse form data
    const name = formData.get('name') as string;
    const description = (formData.get('description') as string) || '';
    const tagsJson = formData.get('tags') as string;
    const includeInRename = formData.get('includeInRename') === 'true';
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

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

    // Update the custom format
    let result;
    try {
      result = await customFormatQueries.updateGeneral({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
        input: {
          name: name.trim(),
          description: description.trim(),
          includeInRename,
          tags,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update custom format';
      if (message.includes('already exists')) {
        return fail(400, { error: message });
      }
      return fail(500, { error: message });
    }

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to update custom format' });
    }

    throw redirect(303, `/custom-formats/${databaseId}/${id}/general`);
  },

  delete: async ({ request, params }) => {
    const { databaseId, id } = params;

    if (!databaseId || !id) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    const formatId = parseInt(id, 10);

    if (isNaN(currentDatabaseId) || isNaN(formatId)) {
      return fail(400, { error: 'Invalid parameters' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    // Get current format for value guards
    const current = await customFormatQueries.general(cache, formatId);
    if (!current) {
      return fail(404, { error: 'Custom format not found' });
    }

    const formData = await request.formData();
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

    // Check layer permission
    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    // Delete the custom format
    const result = await customFormatQueries.remove({
      databaseId: currentDatabaseId,
      cache,
      layer,
      formatId,
      formatName: current.name,
    });

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to delete custom format' });
    }

    throw redirect(303, `/custom-formats/${databaseId}`);
  },
};
