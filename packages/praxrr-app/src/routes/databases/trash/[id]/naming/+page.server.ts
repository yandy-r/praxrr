import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { toSourcedNamingListItem, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import type { SourcedNamingListItem } from '$shared/pcd/display.ts';

export const load: ServerLoad = async ({ parent }) => {
  const { source } = await parent();

  if (!isTrashGuideSupportedArrType(source.arrType)) {
    return { namingConfigs: [] as SourcedNamingListItem[] };
  }

  const sourceRef: TrashGuideSourceRef = {
    id: source.id,
    name: source.name,
    arrType: source.arrType,
  };

  const cacheRows = trashGuideEntityCacheQueries.getBySourceAndType(source.id, 'naming');
  const namingConfigs = cacheRows
    .map((cache) => toSourcedNamingListItem(cache, sourceRef))
    .filter((row): row is SourcedNamingListItem => row !== null);

  return { namingConfigs };
};
