import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { syncHistoryQueries, type SyncHistoryFilters } from '$db/queries/syncHistory.ts';
import { buildSyncHistoryListResponse } from '$sync/syncHistory/responses.ts';
import type { SyncOperationStatus, SyncTrigger } from '$sync/syncHistory/types.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType, type SyncPreviewSection } from '$sync/preview/types.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

const SYNC_HISTORY_STATUSES: readonly SyncOperationStatus[] = ['success', 'partial', 'failed', 'skipped'];
const SYNC_TRIGGERS: readonly SyncTrigger[] = ['manual', 'schedule', 'system'];
const SYNC_PREVIEW_SECTIONS: readonly SyncPreviewSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
  'metadataProfiles',
];

/**
 * Parsed, validated query params for the sync-history list endpoint. All filter
 * fields are optional; `page`/`pageSize` always resolve to a value.
 */
interface ListQuery {
  filters: SyncHistoryFilters;
  page: number;
  pageSize: number;
}

/**
 * Parse a required positive integer (min 1) query param, or throw on a
 * non-numeric / out-of-range value. `pageSize` caps to `max` instead of erroring.
 */
function parsePositiveInt(raw: string | null, fallback: number, name: string, max?: number): number {
  if (raw === null) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid ${name}`);
  }

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}`);
  }

  if (max !== undefined && value > max) {
    return max;
  }

  return value;
}

/**
 * Parse an `arrInstanceId` filter: integer > 0, or throw on any non-numeric /
 * non-positive value.
 */
function parseInstanceId(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error('Invalid instanceId');
  }

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid instanceId');
  }

  return value;
}

function parseArrType(raw: string | null): SyncPreviewArrType | undefined {
  if (raw === null) {
    return undefined;
  }
  if (!isSyncPreviewArrType(raw)) {
    throw new Error('Invalid arrType');
  }
  return raw;
}

function parseStatus(raw: string | null): SyncOperationStatus | undefined {
  if (raw === null) {
    return undefined;
  }
  if (!SYNC_HISTORY_STATUSES.includes(raw as SyncOperationStatus)) {
    throw new Error('Invalid status');
  }
  return raw as SyncOperationStatus;
}

function parseTrigger(raw: string | null): SyncTrigger | undefined {
  if (raw === null) {
    return undefined;
  }
  if (!SYNC_TRIGGERS.includes(raw as SyncTrigger)) {
    throw new Error('Invalid trigger');
  }
  return raw as SyncTrigger;
}

function parseSection(raw: string | null): SyncPreviewSection | undefined {
  if (raw === null) {
    return undefined;
  }
  if (!SYNC_PREVIEW_SECTIONS.includes(raw as SyncPreviewSection)) {
    throw new Error('Invalid section');
  }
  return raw as SyncPreviewSection;
}

/**
 * Validate an ISO-8601 date-time bound via `Date.parse`, passing the original
 * string through to the query (which compares with SQLite `datetime(...)`).
 */
function parseDateBound(raw: string | null, name: string): string | undefined {
  if (raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed || Number.isNaN(Date.parse(trimmed))) {
    throw new Error(`Invalid ${name}`);
  }
  return trimmed;
}

function parseListQuery(url: URL): ListQuery {
  const params = url.searchParams;

  const filters: SyncHistoryFilters = {};

  const instanceId = parseInstanceId(params.get('instanceId'));
  if (instanceId !== undefined) {
    filters.instanceId = instanceId;
  }

  const arrType = parseArrType(params.get('arrType'));
  if (arrType !== undefined) {
    filters.arrType = arrType;
  }

  const status = parseStatus(params.get('status'));
  if (status !== undefined) {
    filters.status = status;
  }

  const trigger = parseTrigger(params.get('trigger'));
  if (trigger !== undefined) {
    filters.trigger = trigger;
  }

  const section = parseSection(params.get('section'));
  if (section !== undefined) {
    filters.section = section;
  }

  const from = parseDateBound(params.get('from'), 'from');
  if (from !== undefined) {
    filters.from = from;
  }

  const to = parseDateBound(params.get('to'), 'to');
  if (to !== undefined) {
    filters.to = to;
  }

  const q = params.get('q')?.trim();
  if (q) {
    filters.q = q;
  }

  const page = parsePositiveInt(params.get('page'), DEFAULT_PAGE, 'page');
  const pageSize = parsePositiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE, 'pageSize', MAX_PAGE_SIZE);

  return { filters, page, pageSize };
}

/**
 * GET /api/v1/sync-history
 *
 * Filtered, paginated list of sync run audit entries (newest first). All filters
 * are optional and combine with AND. Invalid query params return 400; this returns
 * 500 only on an internal error.
 */
export const GET: RequestHandler = async ({ url }) => {
  let query: ListQuery;
  try {
    query = parseListQuery(url);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Invalid query parameters' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  try {
    const { filters, page, pageSize } = query;
    const rows = syncHistoryQueries.search(filters, { limit: pageSize, offset: (page - 1) * pageSize });
    const total = syncHistoryQueries.count(filters);

    return json(buildSyncHistoryListResponse(rows, { page, pageSize, total }));
  } catch (error) {
    await logger.error('Failed to list sync history', {
      source: 'SyncHistoryListRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to list sync history' } satisfies ErrorResponse, { status: 500 });
  }
};
