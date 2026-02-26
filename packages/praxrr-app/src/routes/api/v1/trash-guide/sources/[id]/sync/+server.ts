import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { logTrashGuideRouteError, mapReadErrorStatus, parseSourceId, toErrorMessage } from '../_helpers.ts';
import { enqueueManualTrashGuideSourceSync } from '$jobs/helpers/trashGuideSyncQueue.ts';

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
    if (result.status === 'already_running') {
      return json(
        {
          error: 'TRaSH sync is already running for this source',
          run: result.run,
        },
        { status: 409 }
      );
    }

    return json({
      success: true,
      queued: true,
      job: result.job,
    });
  } catch (error) {
    await logTrashGuideRouteError(error, `Failed to enqueue TRaSH source sync id=${sourceId}`);
    return json({ error: toErrorMessage(error) }, { status: 500 });
  }
};
