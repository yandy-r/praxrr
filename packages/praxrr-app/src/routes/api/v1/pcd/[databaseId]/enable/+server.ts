import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager, ReenableError } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import { schedulePcdSyncForDatabase } from '$jobs/schedule.ts';

const POSITIVE_INTEGER_ID = /^\d+$/;

/** Parse a strictly positive safe-integer path segment, or describe why it is invalid. */
function parsePositiveInteger(rawId: string | undefined, fieldName: string): { value: number } | { error: string } {
  if (!rawId) return { error: `Missing ${fieldName}` };
  if (!POSITIVE_INTEGER_ID.test(rawId)) return { error: `Invalid ${fieldName}` };
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return { error: `Invalid ${fieldName}` };
  return { value: id };
}

/**
 * POST /api/v1/pcd/{databaseId}/enable
 *
 * Re-enable a database that was auto-disabled after a failed cache build/import. The database is
 * recompiled first; on failure it stays disabled and 422 is returned with a generic message.
 */
export const POST: RequestHandler = async ({ params }) => {
  const databaseIdResult = parsePositiveInteger(params.databaseId, 'databaseId');
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }
  const databaseId = databaseIdResult.value;

  try {
    const result = await pcdManager.reenable(databaseId);
    if (result.status === 'enabled') {
      // Disabled databases have their pcd.sync job unscheduled; restore it. A scheduling failure
      // must not turn a successful re-enable into an error response.
      try {
        schedulePcdSyncForDatabase(databaseId);
      } catch (scheduleError) {
        await logger.error('Failed to reschedule PCD sync after re-enable', {
          source: 'PcdEnableApi',
          meta: {
            databaseId,
            error: scheduleError instanceof Error ? scheduleError.message : String(scheduleError),
          },
        });
      }
    }
    return json({ status: result.status });
  } catch (error) {
    if (error instanceof ReenableError) {
      // Details were already logged by the service; the message is generic and client-safe.
      return json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 422 });
    }
    await logger.error('Failed to re-enable database', {
      source: 'PcdEnableApi',
      meta: { databaseId, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to re-enable database' }, { status: 500 });
  }
};
