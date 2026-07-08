import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';

/**
 * Bare `/dependency-graph` landing load -- mirrors resolved-config's bare-route pattern.
 * The nav registry href has no databaseId; the actual viewer lives at
 * `/dependency-graph/[databaseId]`, so this route just supplies the database list for the
 * client-side redirect in +page.svelte.
 */
export const load: ServerLoad = () => {
  const databases = pcdManager.getAll();

  return {
    databases,
  };
};
