import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { parseCachedEntity } from '$lib/server/trashguide/displayTransform.ts';

export const load: ServerLoad = async ({ params, parent }) => {
  const { source } = await parent();
  const trashId = params.trashId;

  if (!trashId) {
    error(400, 'Missing entity ID');
  }

  const cache = trashGuideEntityCacheQueries.getByKey(source.id, trashId, 'custom_format');
  if (!cache) {
    error(404, 'Custom format not found');
  }

  const entity = parseCachedEntity(cache, 'custom_format');
  if (!entity) {
    error(500, 'Failed to parse custom format data');
  }

  return { entity };
};
