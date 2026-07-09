import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';

/**
 * Bare `/goals` landing — mirrors dependency-graph. The editor lives at `/goals/[databaseId]`, so
 * this route just supplies the database list for the client-side redirect in +page.svelte.
 */
export const load: ServerLoad = () => {
  return { databases: pcdManager.getAll() };
};
