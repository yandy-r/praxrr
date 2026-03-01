import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager, snapshotService } from '$pcd/index.ts';
import type { PcdSnapshotFullDetail } from '$pcd/index.ts';
import { db } from '$db/db.ts';
import { logger } from '$logger/logger.ts';

const POSITIVE_INTEGER_ID = /^\d+$/;

function parsePositiveInteger(rawId: string | undefined, fieldName: string): { value: number } | { error: string } {
  if (!rawId) {
    return { error: `Missing ${fieldName}` };
  }

  if (!POSITIVE_INTEGER_ID.test(rawId)) {
    return { error: `Invalid ${fieldName}` };
  }

  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: `Invalid ${fieldName}` };
  }

  return { value: id };
}

function validateDatabaseExists(databaseId: number): { exists: true } | { error: string; status: number } {
  const database = pcdManager.getById(databaseId);
  if (!database) {
    return { error: 'Database not found', status: 404 };
  }

  return { exists: true };
}

/**
 * GET /api/v1/pcd/{databaseId}/snapshots/{snapshotId}
 *
 * Fetch full detail for a single PCD snapshot, including computed fields.
 *
 * Path params:
 * - databaseId: PCD database ID
 * - snapshotId: numeric snapshot ID
 */
export const GET: RequestHandler = async ({ params }) => {
  const databaseIdResult = parsePositiveInteger(params.databaseId, 'databaseId');
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const snapshotIdResult = parsePositiveInteger(params.snapshotId, 'snapshotId');
  if ('error' in snapshotIdResult) {
    return json({ error: snapshotIdResult.error }, { status: 400 });
  }

  const databaseCheck = validateDatabaseExists(databaseIdResult.value);
  if ('error' in databaseCheck) {
    return json({ error: databaseCheck.error }, { status: databaseCheck.status });
  }

  try {
    const snapshot = snapshotService.getDetail(snapshotIdResult.value);
    if (!snapshot) {
      return json({ error: 'Snapshot not found' }, { status: 404 });
    }

    // Ownership enforcement: snapshot must belong to the requested database
    if (snapshot.databaseId !== databaseIdResult.value) {
      return json({ error: 'Snapshot not found' }, { status: 404 });
    }

    // Compute opsWrittenSince
    const maxIdResult = db.queryFirst<{ max_id: number | null }>(
      'SELECT MAX(id) as max_id FROM pcd_ops WHERE database_id = ?',
      databaseIdResult.value
    );
    const currentMaxId = maxIdResult?.max_id ?? 0;
    const opsWrittenSince = currentMaxId > 0 ? Math.max(0, currentMaxId - snapshot.opsSequenceMaxId) : 0;

    // isRestorable: always false for MVP (restore not implemented)
    const isRestorable = false;

    const fullDetail: PcdSnapshotFullDetail = {
      ...snapshot,
      opsWrittenSince,
      isRestorable,
    };

    return json(fullDetail);
  } catch (error) {
    await logger.error('Failed to fetch snapshot details', {
      source: 'SnapshotApi',
      meta: {
        databaseId: databaseIdResult.value,
        snapshotId: snapshotIdResult.value,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to fetch snapshot details' }, { status: 500 });
  }
};

/**
 * DELETE /api/v1/pcd/{databaseId}/snapshots/{snapshotId}
 *
 * Delete a PCD snapshot by ID, enforcing ownership under the provided databaseId.
 *
 * Path params:
 * - databaseId: PCD database ID
 * - snapshotId: numeric snapshot ID
 */
export const DELETE: RequestHandler = async ({ params }) => {
  const databaseIdResult = parsePositiveInteger(params.databaseId, 'databaseId');
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const snapshotIdResult = parsePositiveInteger(params.snapshotId, 'snapshotId');
  if ('error' in snapshotIdResult) {
    return json({ error: snapshotIdResult.error }, { status: 400 });
  }

  const databaseCheck = validateDatabaseExists(databaseIdResult.value);
  if ('error' in databaseCheck) {
    return json({ error: databaseCheck.error }, { status: databaseCheck.status });
  }

  try {
    const snapshot = snapshotService.getDetail(snapshotIdResult.value);
    if (!snapshot) {
      return json({ error: 'Snapshot not found' }, { status: 404 });
    }

    // Ownership enforcement: snapshot must belong to the requested database
    if (snapshot.databaseId !== databaseIdResult.value) {
      return json({ error: 'Snapshot not found' }, { status: 404 });
    }

    snapshotService.deleteSnapshot(snapshotIdResult.value);

    return new Response(null, { status: 204 });
  } catch (error) {
    await logger.error('Failed to delete snapshot', {
      source: 'SnapshotApi',
      meta: {
        databaseId: databaseIdResult.value,
        snapshotId: snapshotIdResult.value,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to delete snapshot' }, { status: 500 });
  }
};
