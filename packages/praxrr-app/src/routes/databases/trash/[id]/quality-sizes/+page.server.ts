import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import {
  toSourcedQualityDefinitionListItem,
  type TrashGuideSourceRef,
} from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import type { SourcedQualityDefinitionListItem } from '$shared/pcd/display.ts';

export const load: ServerLoad = async ({ parent }) => {
  const { source } = await parent();

  if (!isTrashGuideSupportedArrType(source.arrType)) {
    return { qualitySizes: [] as SourcedQualityDefinitionListItem[] };
  }

  const sourceRef: TrashGuideSourceRef = {
    id: source.id,
    name: source.name,
    arrType: source.arrType,
  };

  const cacheRows = trashGuideEntityCacheQueries.getBySourceAndType(source.id, 'quality_size');
  const qualitySizes = cacheRows
    .map((cache) => toSourcedQualityDefinitionListItem(cache, sourceRef))
    .filter((row): row is SourcedQualityDefinitionListItem => row !== null);

  return { qualitySizes };
};
