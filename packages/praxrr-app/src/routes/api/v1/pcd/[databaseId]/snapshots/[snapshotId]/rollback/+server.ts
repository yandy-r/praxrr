import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager, snapshotService } from '$pcd/index.ts';
import {
  isRollbackPostVerifyError,
  isRollbackStaleError,
  isRollbackUnverifiableError,
} from '$pcd/snapshots/rollback/types.ts';
import { logger } from '$logger/logger.ts';

const POSITIVE_INTEGER_ID = /^\d+$/;
const MAX_BODY_BYTES = 8 * 1024;

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
 * POST /api/v1/pcd/{databaseId}/snapshots/{snapshotId}/rollback
 *
 * Execute a Point-in-Time Restore of PCD state to this snapshot (issue #16). The body must
 * carry `expectedCurrentStateHash` (from the preview) as a from-state value-guard; if the
 * live PCD state changed since the preview the request is rejected (422) and the caller must
 * regenerate the preview.
 */
export const POST: RequestHandler = async ({ params, request }) => {
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

  // Reject oversized bodies via Content-Length before buffering; the post-read check below
  // still guards the case where the header is absent or understates the actual size.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, { status: 400 });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const expectedCurrentStateHash = (body as { expectedCurrentStateHash?: unknown }).expectedCurrentStateHash;
  if (typeof expectedCurrentStateHash !== 'string') {
    return json({ error: 'Missing or invalid expectedCurrentStateHash' }, { status: 400 });
  }

  try {
    const snapshot = snapshotService.getDetail(snapshotIdResult.value);
    if (!snapshot || snapshot.databaseId !== databaseIdResult.value) {
      return json({ error: 'Snapshot not found' }, { status: 404 });
    }

    const result = await snapshotService.restore(snapshotIdResult.value, expectedCurrentStateHash);
    return json(result);
  } catch (error) {
    if (isRollbackStaleError(error)) {
      return json({ error: error.message }, { status: 422 });
    }
    if (isRollbackUnverifiableError(error)) {
      return json({ error: error.message }, { status: 409 });
    }
    if (isRollbackPostVerifyError(error)) {
      await logger.error('Rollback failed post-verify', {
        source: 'SnapshotRollbackApi',
        meta: {
          databaseId: databaseIdResult.value,
          snapshotId: snapshotIdResult.value,
          error: error.message,
        },
      });
      return json({ error: error.message }, { status: 500 });
    }

    await logger.error('Failed to execute rollback', {
      source: 'SnapshotRollbackApi',
      meta: {
        databaseId: databaseIdResult.value,
        snapshotId: snapshotIdResult.value,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to execute rollback' }, { status: 500 });
  }
};
