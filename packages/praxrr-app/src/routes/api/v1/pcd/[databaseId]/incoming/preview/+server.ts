import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { previewIncoming } from '$pcd/incoming/preview.ts';
import { IncomingPreviewError, incomingPreviewErrorStatus } from '$pcd/incoming/types.ts';
import { logger } from '$logger/logger.ts';

const POSITIVE_INTEGER_ID = /^\d+$/;

function parseDatabaseId(rawId: string | undefined): { value: number } | { error: string } {
  if (!rawId) {
    return { error: 'Missing databaseId' };
  }

  if (!POSITIVE_INTEGER_ID.test(rawId)) {
    return { error: 'Invalid databaseId' };
  }

  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Invalid databaseId' };
  }

  return { value: id };
}

const INCOMING_PREVIEW_MESSAGES = {
  sync_in_progress: 'A sync is currently running for this database; try again once it finishes',
  preview_stale: 'The local state changed while building the preview; run the preview again',
  fetch_failed: 'Failed to contact the upstream repository',
  incoming_unavailable: 'The incoming changes cannot be previewed',
} as const;

/**
 * GET /api/v1/pcd/{databaseId}/incoming/preview
 *
 * Read-only preview of what pulling the upstream branch would change per entity and which
 * local user ops would conflict. Accepts no ref/URL parameter: the branch comes from the clone.
 * Never changes pcd_ops, pcd_op_history, the clone's HEAD or its working tree.
 */
export const GET: RequestHandler = async ({ params }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId);
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }
  const databaseId = databaseIdResult.value;

  if (!pcdManager.getById(databaseId)) {
    return json({ error: 'Database not found' }, { status: 404 });
  }

  try {
    return json(await previewIncoming(databaseId));
  } catch (error) {
    if (error instanceof IncomingPreviewError) {
      // Fixed message per code (detail stays in the log): error.message can embed upstream
      // identifiers we do not want to surface raw.
      await logger.warn('Incoming preview unavailable', {
        source: 'IncomingPreviewApi',
        meta: { databaseId, code: error.code, error: error.message },
      });
      return json(
        { error: INCOMING_PREVIEW_MESSAGES[error.code], code: error.code },
        { status: incomingPreviewErrorStatus(error.code) }
      );
    }

    await logger.error('Failed to generate incoming preview', {
      source: 'IncomingPreviewApi',
      meta: {
        databaseId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to generate incoming preview' }, { status: 500 });
  }
};
