import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';

export const load: ServerLoad = async () => {
  const databases = pcdManager.getAll();

  if (!databases) {
    throw error(500, 'Failed to load databases');
  }

  return {
    databases,
  };
};
