import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { toSyncHistoryDetail } from '$sync/syncHistory/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

function parseId(raw: string | undefined): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * GET /api/v1/sync-history/{id}
 *
 * Full detail for a single sync history entry, including section results and entity changes.
 * Returns 404 when the entry does not exist; 400 on an invalid id; 500 only on internal error.
 */
export const GET: RequestHandler = async ({ params }) => {
  const id = parseId(params.id);
  if (id === null) {
    return json({ error: 'Invalid sync history id' } satisfies ErrorResponse, { status: 400 });
  }

  try {
    const record = syncHistoryQueries.getById(id);
    if (!record) {
      return json({ error: 'Sync history entry not found' } satisfies ErrorResponse, { status: 404 });
    }
    return json(toSyncHistoryDetail(record));
  } catch (error) {
    await logger.error('Failed to read sync history detail', {
      source: 'SyncHistoryDetailRoute',
      meta: { id, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to read sync history detail' } satisfies ErrorResponse, { status: 500 });
  }
};
