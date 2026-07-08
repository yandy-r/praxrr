import { error, redirect, fail } from '@sveltejs/kit';
import type { ServerLoad, Actions } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase, getImpact } from '$pcd/index.ts';
import { sanitizeBigInts } from '$http/sanitizeBigInts.ts';
import * as regularExpressionQueries from '$pcd/entities/regularExpressions/index.ts';
import { parseOperationLayer } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';

export const load: ServerLoad = async ({ params }) => {
  const { databaseId, id } = params;

  if (!databaseId || !id) {
    throw error(400, 'Missing parameters');
  }

  const currentDatabaseId = parseInt(databaseId, 10);
  const regexId = parseInt(id, 10);

  if (isNaN(currentDatabaseId) || isNaN(regexId)) {
    throw error(400, 'Invalid parameters');
  }

  const currentDatabase = pcdManager.getById(currentDatabaseId);
  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(500, 'Database cache not available');
  }

  const regularExpression = await regularExpressionQueries.get(cache, regexId);
  if (!regularExpression) {
    throw error(404, 'Regular expression not found');
  }

  // Eager reverse-dependency impact (custom formats whose conditions use this regex) so the
  // delete-confirm modal has cascade data without a lazy round-trip. Defensive: a graph
  // failure must never break the editor.
  let impact = null;
  try {
    impact = sanitizeBigInts(
      await getImpact(
        cache,
        currentDatabaseId,
        { kind: 'regular_expression', name: regularExpression.name },
        {
          direction: 'dependents',
          depth: 1,
        }
      )
    );
  } catch {
    impact = null;
  }

  return {
    currentDatabase,
    regularExpression,
    impact,
    canWriteToBase: canWriteToBase(currentDatabaseId),
  };
};

export const actions: Actions = {
  update: async ({ request, params }) => {
    const { databaseId, id } = params;

    if (!databaseId || !id) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    const regexId = parseInt(id, 10);

    if (isNaN(currentDatabaseId) || isNaN(regexId)) {
      return fail(400, { error: 'Invalid parameters' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    // Get current regular expression for value guards
    const current = await regularExpressionQueries.get(cache, regexId);
    if (!current) {
      return fail(404, { error: 'Regular expression not found' });
    }

    const formData = await request.formData();

    // Parse form data
    const name = formData.get('name') as string;
    const tagsJson = formData.get('tags') as string;
    const pattern = formData.get('pattern') as string;
    const description = (formData.get('description') as string) || null;
    const regex101Id = (formData.get('regex101Id') as string) || null;
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

    // Validate
    if (!name?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    if (!pattern?.trim()) {
      return fail(400, { error: 'Pattern is required' });
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

    // Update the regular expression
    let result;
    try {
      result = await regularExpressionQueries.update({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
        input: {
          name: name.trim(),
          pattern: pattern.trim(),
          tags,
          description: description?.trim() || null,
          regex101Id: regex101Id?.trim() || null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update regular expression';
      if (message.includes('already exists')) {
        return fail(400, { error: message });
      }
      return fail(500, { error: message });
    }

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to update regular expression' });
    }

    throw redirect(303, `/regular-expressions/${databaseId}`);
  },

  delete: async ({ request, params }) => {
    const { databaseId, id } = params;

    if (!databaseId || !id) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    const regexId = parseInt(id, 10);

    if (isNaN(currentDatabaseId) || isNaN(regexId)) {
      return fail(400, { error: 'Invalid parameters' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    // Get current regular expression for value guards
    const current = await regularExpressionQueries.get(cache, regexId);
    if (!current) {
      return fail(404, { error: 'Regular expression not found' });
    }

    const formData = await request.formData();
    const layerFromForm = formData.get('layer');
    const layerResult = parseOperationLayer(layerFromForm);
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

    await logger.debug('Delete action received', {
      source: 'RegularExpressionDelete',
      meta: {
        regexId,
        regexName: current.name,
        layerFromForm,
        layerUsed: layer,
      },
    });

    // Check layer permission
    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    const result = await regularExpressionQueries.remove({
      databaseId: currentDatabaseId,
      cache,
      layer,
      current,
    });

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to delete regular expression' });
    }

    throw redirect(303, `/regular-expressions/${databaseId}`);
  },
};
