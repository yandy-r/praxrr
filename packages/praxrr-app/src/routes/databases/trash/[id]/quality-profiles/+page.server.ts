import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { toSourcedQualityProfileRow, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import type { QualityProfileTableRow } from '$shared/pcd/display.ts';

export const load: ServerLoad = async ({ parent }) => {
  const { source } = await parent();

  if (!isTrashGuideSupportedArrType(source.arrType)) {
    return { qualityProfiles: [] as QualityProfileTableRow[] };
  }

  const sourceRef: TrashGuideSourceRef = {
    id: source.id,
    name: source.name,
    arrType: source.arrType,
  };

  const cacheRows = trashGuideEntityCacheQueries.getBySourceAndType(source.id, 'quality_profile');
  const qualityProfiles = cacheRows
    .map((cache) => toSourcedQualityProfileRow(cache, sourceRef))
    .filter((row): row is QualityProfileTableRow => row !== null);

  return { qualityProfiles };
};
