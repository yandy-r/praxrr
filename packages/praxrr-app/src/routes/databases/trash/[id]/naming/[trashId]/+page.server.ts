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

  const cache = trashGuideEntityCacheQueries.getByKey(source.id, trashId, 'naming');
  if (!cache) {
    error(404, 'Naming config not found');
  }

  const entity = parseCachedEntity(cache, 'naming');
  if (!entity) {
    error(500, 'Failed to parse naming data');
  }

  return {
    entity,
    fetchedAt: cache.fetchedAt,
  };
};
