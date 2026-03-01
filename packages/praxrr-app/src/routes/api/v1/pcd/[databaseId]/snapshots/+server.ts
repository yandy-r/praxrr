import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager, snapshotService } from '$pcd/index.ts';
import type { SnapshotType } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';

const POSITIVE_INTEGER_ID = /^\d+$/;
const VALID_SNAPSHOT_TYPES: SnapshotType[] = ['auto', 'manual'];
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;

function parseDatabaseId(rawId: string | undefined): { value: number } | { error: string } {
  if (!rawId) {
    return { error: 'Missing databaseId' };
  }

  if (!POSITIVE_INTEGER_ID.test(rawId)) {
    return { error: 'Invalid databaseId' };
  }

  const databaseId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(databaseId) || databaseId <= 0) {
    return { error: 'Invalid databaseId' };
  }

  return { value: databaseId };
}

function validateDatabaseExists(databaseId: number): { exists: true } | { error: string; status: number } {
  const database = pcdManager.getById(databaseId);
  if (!database) {
    return { error: 'Database not found', status: 404 };
  }

  return { exists: true };
}

/**
 * GET /api/v1/pcd/{databaseId}/snapshots
 *
 * List PCD snapshots for a database with optional filtering and pagination.
 *
 * Query params:
 * - type: optional, 'auto' or 'manual'
 * - limit: optional, integer 1-200 (default 50)
 * - offset: optional, integer >= 0 (default 0)
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId);
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const databaseCheck = validateDatabaseExists(databaseIdResult.value);
  if ('error' in databaseCheck) {
    return json({ error: databaseCheck.error }, { status: databaseCheck.status });
  }

  // Parse type filter
  const rawType = url.searchParams.get('type');
  let type: SnapshotType | undefined;
  if (rawType !== null) {
    if (!VALID_SNAPSHOT_TYPES.includes(rawType as SnapshotType)) {
      return json({ error: `Invalid type parameter: must be 'auto' or 'manual'` }, { status: 400 });
    }
    type = rawType as SnapshotType;
  }

  // Parse limit
  const rawLimit = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isInteger(parsed) || String(parsed) !== rawLimit) {
      return json({ error: 'Invalid limit parameter: must be an integer' }, { status: 400 });
    }
    limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, parsed));
  }

  // Parse offset
  const rawOffset = url.searchParams.get('offset');
  let offset = DEFAULT_OFFSET;
  if (rawOffset !== null) {
    const parsed = Number.parseInt(rawOffset, 10);
    if (!Number.isInteger(parsed) || String(parsed) !== rawOffset) {
      return json({ error: 'Invalid offset parameter: must be an integer' }, { status: 400 });
    }
    if (parsed < 0) {
      return json({ error: 'Invalid offset parameter: must be non-negative' }, { status: 400 });
    }
    offset = parsed;
  }

  try {
    const result = snapshotService.list(databaseIdResult.value, { type, limit, offset });
    return json(result);
  } catch (err) {
    await logger.error('Failed to list snapshots', {
      source: 'SnapshotApi',
      meta: {
        databaseId: databaseIdResult.value,
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
    return json({ error: 'Failed to list snapshots' }, { status: 500 });
  }
};

/**
 * POST /api/v1/pcd/{databaseId}/snapshots
 *
 * Create a manual snapshot for the specified database.
 *
 * Body (optional):
 * - description: optional string description for the snapshot
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId);
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const databaseCheck = validateDatabaseExists(databaseIdResult.value);
  if ('error' in databaseCheck) {
    return json({ error: databaseCheck.error }, { status: databaseCheck.status });
  }

  // Parse optional body
  let description: string | undefined;

  const contentType = request.headers.get('content-type');
  const hasJsonContent = contentType && contentType.includes('application/json');

  if (hasJsonContent) {
    let body: unknown;
    try {
      const text = await request.text();
      if (text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      return json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (body !== undefined && body !== null) {
      if (typeof body !== 'object' || Array.isArray(body)) {
        return json({ error: 'Invalid request body' }, { status: 400 });
      }

      const root = body as Record<string, unknown>;
      if ('description' in root) {
        if (root.description !== undefined && root.description !== null) {
          if (typeof root.description !== 'string') {
            return json({ error: 'Description must be a string' }, { status: 400 });
          }
          const trimmed = root.description.trim();
          if (trimmed) {
            description = trimmed;
          }
        }
      }
    }
  }

  try {
    const snapshot = await snapshotService.createManualSnapshot({
      databaseId: databaseIdResult.value,
      description,
    });
    return json(snapshot, { status: 201 });
  } catch (err) {
    await logger.error('Failed to create manual snapshot', {
      source: 'SnapshotApi',
      meta: {
        databaseId: databaseIdResult.value,
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
    return json({ error: 'Failed to create snapshot' }, { status: 500 });
  }
};
