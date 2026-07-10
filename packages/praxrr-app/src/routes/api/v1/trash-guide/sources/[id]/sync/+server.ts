import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { logTrashGuideRouteError, mapReadErrorStatus, parseSourceId, toErrorMessage } from '../../_helpers.ts';
import { enqueueManualTrashGuideSourceSync, getTrashGuideSyncStatus } from '$jobs/helpers/trashGuideSyncQueue.ts';

function statusUrlFor(sourceId: number): string {
  return `/api/v1/trash-guide/sources/${sourceId}/sync`;
}

/**
 * POST /api/v1/trash-guide/sources/[id]/sync
 *
 * Enqueue a manual TRaSH source sync. The response carries the per-run correlation token and the
 * source-labeled status view so the initiating surface can link to exactly one current-or-terminal
 * run (issue #238). An already-running source dedupes onto the in-flight run instead of acking a new one.
 *
 * @param {{ params: { id?: string } }} event - Route event.
 * @returns {Promise<Response>} JSON response with queue/run correlation.
 * @throws {never} Returns errors in JSON payloads instead of throwing.
 */
export const POST: RequestHandler = async ({ params }) => {
  const sourceIdResult = parseSourceId(params.id);
  if ('error' in sourceIdResult) {
    return json({ error: sourceIdResult.error }, { status: 400 });
  }

  const sourceId = sourceIdResult.value;

  try {
    // Guard to ensure the requested source exists before queuing work.
    trashGuideManager.getSource(sourceId);
  } catch (error) {
    const status = mapReadErrorStatus(error);
    if (status >= 500) {
      await logTrashGuideRouteError(error, `Failed to validate TRaSH source id=${sourceId} before sync`);
    }
    return json({ error: toErrorMessage(error) }, { status });
  }

  try {
    const result = enqueueManualTrashGuideSourceSync(sourceId);
    const statusUrl = statusUrlFor(sourceId);

    if (result.status === 'already_running') {
      return json(
        {
          error: 'TRaSH sync is already running for this source',
          deduped: true,
          runToken: result.runToken,
          statusUrl,
          view: result.view
        },
        { status: 409 }
      );
    }

    return json({
      success: true,
      queued: true,
      runToken: result.runToken,
      statusUrl,
      view: result.view
    });
  } catch (error) {
    await logTrashGuideRouteError(error, `Failed to enqueue TRaSH source sync id=${sourceId}`);
    return json({ error: toErrorMessage(error) }, { status: 500 });
  }
};

/**
 * GET /api/v1/trash-guide/sources/[id]/sync
 *
 * Resolve the current queue slot + latest terminal run evidence for a source (issue #238). Used by the
 * initiating surface to poll a queued/running sync to its exact terminal run. Read-only and safe for a
 * since-deleted source: identity falls back to the durable snapshot, so it never 404s on that case.
 *
 * @param {{ params: { id?: string } }} event - Route event.
 * @returns {Promise<Response>} JSON `TrashGuideSyncStatusView`.
 * @throws {never} Returns errors in JSON payloads instead of throwing.
 */
export const GET: RequestHandler = async ({ params }) => {
  const sourceIdResult = parseSourceId(params.id);
  if ('error' in sourceIdResult) {
    return json({ error: sourceIdResult.error }, { status: 400 });
  }

  try {
    return json(getTrashGuideSyncStatus(sourceIdResult.value));
  } catch (error) {
    await logTrashGuideRouteError(error, `Failed to resolve TRaSH sync status id=${sourceIdResult.value}`);
    return json({ error: toErrorMessage(error) }, { status: 500 });
  }
};
