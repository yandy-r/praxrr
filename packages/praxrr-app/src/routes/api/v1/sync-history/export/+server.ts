import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { syncHistoryQueries, type SyncHistoryDetail, type SyncHistoryFilters } from '$db/queries/syncHistory.ts';
import { parseDateBound } from '$sync/syncHistory/filters.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

type ExportFormat = 'json' | 'csv';

/** Upper bound on exported rows; a hit is logged so a silent truncation is visible. */
const EXPORT_ROW_CAP = 50000;

const STATUSES = new Set(['success', 'partial', 'failed', 'skipped']);
const TRIGGERS = new Set(['manual', 'schedule', 'system']);
const SECTIONS = new Set(['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles']);

/**
 * Scalar CSV columns in output order. Array/object cells (sectionsAttempted,
 * sectionResults, changes) are JSON-encoded per cell.
 */
const CSV_COLUMNS: (keyof SyncHistoryDetail)[] = [
  'id',
  'arrInstanceId',
  'instanceName',
  'arrType',
  'jobId',
  'trigger',
  'triggerEvent',
  'sectionsAttempted',
  'status',
  'sectionsRun',
  'itemsSynced',
  'failureCount',
  'entityChangeCount',
  'error',
  'startedAt',
  'finishedAt',
  'durationMs',
  'sectionResults',
  'changes',
];

/**
 * CSV field escape:
 * 1. Neutralize spreadsheet formula injection (CWE-1236) — a value whose first
 *    character is `= + - @` (or tab/CR) is evaluated as a formula by Excel/Sheets
 *    even inside quotes, so prefix it with an apostrophe. `error`/`instanceName`
 *    carry externally-influenced text, so this is a real vector.
 * 2. RFC-4180 quoting — wrap in double-quotes and double embedded quotes when the
 *    value contains a quote, comma, or newline.
 */
function escapeCsv(value: string): string {
  let escaped = value;
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = `'${escaped}`;
  }
  if (/[",\r\n]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

function cellValue(record: SyncHistoryDetail, column: keyof SyncHistoryDetail): string {
  const value = record[column];
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function toCsv(records: SyncHistoryDetail[]): string {
  const rows: string[] = [];
  rows.push(CSV_COLUMNS.map((column) => escapeCsv(column)).join(','));
  for (const record of records) {
    rows.push(CSV_COLUMNS.map((column) => escapeCsv(cellValue(record, column))).join(','));
  }
  return rows.join('\r\n');
}

/**
 * GET /api/v1/sync-history/export
 *
 * Streams the filtered sync history (same filters as the list endpoint, no pagination)
 * as a JSON array or CSV file download. Invalid query params return 400; 500 only on
 * an internal error.
 */
export const GET: RequestHandler = async ({ url }) => {
  const params = url.searchParams;

  const formatParam = params.get('format');
  if (formatParam !== null && formatParam !== 'json' && formatParam !== 'csv') {
    return json({ error: "format must be 'json' or 'csv'" } satisfies ErrorResponse, { status: 400 });
  }
  const format: ExportFormat = formatParam === 'csv' ? 'csv' : 'json';

  const filters: SyncHistoryFilters = {};

  const instanceIdParam = params.get('instanceId');
  if (instanceIdParam !== null) {
    const instanceId = Number(instanceIdParam);
    if (!Number.isInteger(instanceId) || instanceId <= 0) {
      return json({ error: 'instanceId must be a positive integer' } satisfies ErrorResponse, { status: 400 });
    }
    filters.instanceId = instanceId;
  }

  const arrType = params.get('arrType');
  if (arrType !== null) {
    if (!isSyncPreviewArrType(arrType)) {
      return json({ error: 'arrType must be one of radarr, sonarr, lidarr' } satisfies ErrorResponse, { status: 400 });
    }
    filters.arrType = arrType;
  }

  const status = params.get('status');
  if (status !== null) {
    if (!STATUSES.has(status)) {
      return json({ error: 'status must be one of success, partial, failed, skipped' } satisfies ErrorResponse, {
        status: 400,
      });
    }
    filters.status = status;
  }

  const trigger = params.get('trigger');
  if (trigger !== null) {
    if (!TRIGGERS.has(trigger)) {
      return json({ error: 'trigger must be one of manual, schedule, system' } satisfies ErrorResponse, {
        status: 400,
      });
    }
    filters.trigger = trigger;
  }

  const section = params.get('section');
  if (section !== null) {
    if (!SECTIONS.has(section)) {
      return json(
        {
          error: 'section must be one of qualityProfiles, delayProfiles, mediaManagement, metadataProfiles',
        } satisfies ErrorResponse,
        { status: 400 }
      );
    }
    filters.section = section;
  }

  try {
    const from = parseDateBound(params.get('from'), 'from', 'lower');
    if (from !== undefined) {
      filters.from = from;
    }
    const to = parseDateBound(params.get('to'), 'to', 'upper');
    if (to !== undefined) {
      filters.to = to;
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Invalid date bound' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  const q = params.get('q')?.trim();
  if (q) {
    filters.q = q;
  }

  try {
    const rows = syncHistoryQueries.searchAll(filters, EXPORT_ROW_CAP);
    if (rows.length === EXPORT_ROW_CAP) {
      await logger.warn('Sync history export hit the row cap; results are truncated', {
        source: 'SyncHistoryExportRoute',
        meta: { cap: EXPORT_ROW_CAP },
      });
    }
    const timestamp = new Date().toISOString();

    if (format === 'csv') {
      return new Response(toCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="sync-history-${timestamp}.csv"`,
        },
      });
    }

    return new Response(JSON.stringify(rows), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="sync-history-${timestamp}.json"`,
      },
    });
  } catch (error) {
    await logger.error('Failed to export sync history', {
      source: 'SyncHistoryExportRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to export sync history' } satisfies ErrorResponse, { status: 500 });
  }
};
