import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { getDiff } from '$utils/git/index.ts';
import { isAIEnabled, generateCommitMessage } from '$utils/ai/client.ts';

/**
 * POST /api/databases/{id}/generate-commit-message
 *
 * Generate a commit message from the current working-tree diff.
 * Requires AI to be enabled and returns 400 if no diff exists.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  if (!isAIEnabled()) {
    error(503, 'AI is not configured. Enable it in Settings > General.');
  }

  const id = parseInt(params.id || '', 10);
  const database = databaseInstancesQueries.getById(id);

  if (!database) {
    error(404, 'Database not found');
  }

  const body = await request.json();
  const files = body.files as string[] | undefined;

  const diff = await getDiff(database.local_path, files);

  if (!diff.trim()) {
    error(400, 'No changes to generate message for');
  }

  try {
    const message = await generateCommitMessage(diff);
    return json({ message });
  } catch (err) {
    error(500, err instanceof Error ? err.message : 'Failed to generate commit message');
  }
};
