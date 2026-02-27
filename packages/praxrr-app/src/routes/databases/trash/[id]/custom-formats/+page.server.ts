import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { toSourcedCustomFormatRow, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import type { CustomFormatTableRow } from '$shared/pcd/display.ts';

export const load: ServerLoad = async ({ parent }) => {
  const { source } = await parent();

  if (!isTrashGuideSupportedArrType(source.arrType)) {
    return { customFormats: [] as CustomFormatTableRow[] };
  }

  const sourceRef: TrashGuideSourceRef = {
    id: source.id,
    name: source.name,
    arrType: source.arrType,
  };

  const cacheRows = trashGuideEntityCacheQueries.getBySourceAndType(source.id, 'custom_format');
  const customFormats = cacheRows
    .map((cache) => toSourcedCustomFormatRow(cache, sourceRef))
    .filter((row): row is CustomFormatTableRow => row !== null);

  return { customFormats };
};
