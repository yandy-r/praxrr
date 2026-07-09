import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager, snapshotService } from '$pcd/index.ts';
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
 * GET /api/v1/pcd/{databaseId}/snapshots/{snapshotId}/rollback/preview
 *
 * Read-only, PCD-to-PCD preview of exactly what restoring this snapshot would change in the
 * PCD desired state (issue #16). Does not contact any Arr instance. The returned
 * `currentStateHash` is the from-state value-guard that the execute endpoint requires.
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
    if (!snapshot || snapshot.databaseId !== databaseIdResult.value) {
      return json({ error: 'Snapshot not found' }, { status: 404 });
    }

    const preview = await snapshotService.previewRestore(snapshotIdResult.value);
    return json(preview);
  } catch (error) {
    await logger.error('Failed to generate rollback preview', {
      source: 'SnapshotRollbackApi',
      meta: {
        databaseId: databaseIdResult.value,
        snapshotId: snapshotIdResult.value,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to generate rollback preview' }, { status: 500 });
  }
};
