import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { syncHistoryQueries, type SyncHistoryDetail, type SyncHistoryFilters } from '$db/queries/syncHistory.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

type ExportFormat = 'json' | 'csv';

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
 * RFC-4180 field escape: wrap in double-quotes and double any embedded quotes
 * when the value contains a quote, comma, or newline.
 */
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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

  const from = params.get('from');
  if (from !== null) {
    if (Number.isNaN(Date.parse(from))) {
      return json({ error: 'from must be an ISO-8601 date-time' } satisfies ErrorResponse, { status: 400 });
    }
    filters.from = from;
  }

  const to = params.get('to');
  if (to !== null) {
    if (Number.isNaN(Date.parse(to))) {
      return json({ error: 'to must be an ISO-8601 date-time' } satisfies ErrorResponse, { status: 400 });
    }
    filters.to = to;
  }

  const q = params.get('q');
  if (q !== null && q !== '') {
    filters.q = q;
  }

  try {
    const rows = syncHistoryQueries.searchAll(filters);
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
