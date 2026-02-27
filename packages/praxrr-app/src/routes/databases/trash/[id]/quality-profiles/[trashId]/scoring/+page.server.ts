import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { parseCachedEntity } from '$lib/server/trashguide/displayTransform.ts';
import type { TrashGuideCustomFormatEntity } from '$lib/server/trashguide/types.ts';

export const load: ServerLoad = async ({ params, parent }) => {
  const { source } = await parent();
  const trashId = params.trashId;

  if (!trashId) {
    error(400, 'Missing entity ID');
  }

  const cache = trashGuideEntityCacheQueries.getByKey(source.id, trashId, 'quality_profile');
  if (!cache) {
    error(404, 'Quality profile not found');
  }

  const entity = parseCachedEntity(cache, 'quality_profile');
  if (!entity) {
    error(500, 'Failed to parse quality profile data');
  }

  const cfByTrashId = buildCustomFormatLookup(source.id);
  const scoreSet = entity.score_set?.trim() || 'default';

  const scoringItems = entity.format_items.map((item) => {
    if (item.score !== null) {
      return { name: item.name, score: item.score, custom_format_trash_id: item.custom_format_trash_id };
    }

    if (item.custom_format_trash_id) {
      const cf = cfByTrashId.get(item.custom_format_trash_id.toLowerCase());
      if (cf) {
        const resolved = cf.scores[scoreSet] ?? cf.scores.default ?? null;
        return { name: item.name, score: resolved, custom_format_trash_id: item.custom_format_trash_id };
      }
    }

    return { name: item.name, score: null, custom_format_trash_id: item.custom_format_trash_id };
  });

  return { entity, scoringItems };
};

function buildCustomFormatLookup(sourceId: number): Map<string, TrashGuideCustomFormatEntity> {
  const cfCacheRows = trashGuideEntityCacheQueries.getBySourceAndType(sourceId, 'custom_format');
  const lookup = new Map<string, TrashGuideCustomFormatEntity>();

  for (const row of cfCacheRows) {
    const cf = parseCachedEntity(row, 'custom_format');
    if (cf) {
      lookup.set(row.trashId.toLowerCase(), cf);
    }
  }

  return lookup;
}
