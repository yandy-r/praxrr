import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { trashGuideManager, type TrashGuideSourceResponse } from '$lib/server/trashguide/manager.ts';
import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';

export const load: LayoutServerLoad = ({ params }): { source: TrashGuideSourceResponse } => {
  const id = parseInt(params.id || '', 10);

  if (isNaN(id)) {
    error(400, 'Invalid source ID');
  }

  try {
    const source = trashGuideManager.getSource(id);
    return { source };
  } catch (err) {
    if (err instanceof TrashGuideSourceNotFoundError) {
      error(404, 'TRaSH source not found');
    }
    throw err;
  }
};
