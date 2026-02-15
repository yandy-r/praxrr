import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';

/**
 * GET /api/databases
 * Returns all linked database instances
 */
export const GET: RequestHandler = () => {
  try {
    const databases = pcdManager.getAll();
    return json(databases);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
};
