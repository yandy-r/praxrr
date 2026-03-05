import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';

export const load: ServerLoad = () => {
  // Get all databases
  const databases = pcdManager.getAll();

  return {
    databases,
  };
};
