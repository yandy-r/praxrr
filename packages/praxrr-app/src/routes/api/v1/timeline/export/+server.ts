import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { parseTimelineFilters } from '$lib/server/timeline/filters.ts';
import { TimelineHttpError } from '$lib/server/timeline/errors.ts';
import { exportTimeline } from '$lib/server/timeline/service.ts';
import type { TimelineEvent } from '$lib/server/timeline/types.ts';
import { logger } from '$logger/logger.ts';
import { escapeCsvCell } from '$utils/export/csv.ts';

type ErrorResponse = { error: string };
type ExportFormat = 'json' | 'csv';

/** Upper bound on exported rows; a hit is logged so a silent truncation is visible. */
const EXPORT_ROW_CAP = 50000;

/** Scalar CSV columns in output order. Nested cells (metrics, annotations) are JSON-encoded. */
const CSV_COLUMNS: readonly (keyof TimelineEvent | 'scopeKind' | 'scopeId' | 'scopeLabel' | 'arrType')[] = [
  'id',
  'source',
  'sourceId',
  'timestamp',
  'type',
  'status',
  'badge',
  'scopeKind',
  'scopeId',
  'scopeLabel',
  'arrType',
  'title',
  'detailHref',
  'metrics',
  'annotations',
];

function cellValue(event: TimelineEvent, column: (typeof CSV_COLUMNS)[number]): string {
  switch (column) {
    case 'scopeKind':
      return event.scope.kind;
    case 'scopeId':
      return event.scope.id === null ? '' : String(event.scope.id);
    case 'scopeLabel':
      return event.scope.label ?? '';
    case 'arrType':
      return event.scope.arrType ?? '';
    case 'metrics':
      return JSON.stringify(event.metrics);
    case 'annotations':
      return JSON.stringify(event.annotations);
    default: {
      const value = event[column];
      return value === null || value === undefined ? '' : String(value);
    }
  }
}

function toCsv(events: TimelineEvent[]): string {
  const rows: string[] = [];
  rows.push(CSV_COLUMNS.map((column) => escapeCsvCell(column)).join(','));
  for (const event of events) {
    rows.push(CSV_COLUMNS.map((column) => escapeCsvCell(cellValue(event, column))).join(','));
  }
  return rows.join('\r\n');
}

/**
 * GET /api/v1/timeline/export
 *
 * Streams the filtered timeline (same filters/gating as the list endpoint, no pagination) as a
 * JSON array or CSV file download, capped server-side.
 */
export const GET: RequestHandler = async ({ url }) => {
  const formatParam = url.searchParams.get('format');
  if (formatParam !== null && formatParam !== 'json' && formatParam !== 'csv') {
    return json({ error: "format must be 'json' or 'csv'" } satisfies ErrorResponse, { status: 400 });
  }
  const format: ExportFormat = formatParam === 'csv' ? 'csv' : 'json';

  let events: TimelineEvent[];
  try {
    const filters = parseTimelineFilters(url);
    events = exportTimeline(filters, EXPORT_ROW_CAP);
  } catch (error) {
    if (error instanceof TimelineHttpError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }
    await logger.error('Failed to export timeline', {
      source: 'TimelineExportRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to export timeline' } satisfies ErrorResponse, { status: 500 });
  }

  if (events.length === EXPORT_ROW_CAP) {
    await logger.warn('Timeline export hit the row cap; results are truncated', {
      source: 'TimelineExportRoute',
      meta: { cap: EXPORT_ROW_CAP },
    });
  }
  const timestamp = new Date().toISOString();

  if (format === 'csv') {
    return new Response(toCsv(events), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="timeline-${timestamp}.csv"`,
      },
    });
  }

  return new Response(JSON.stringify(events), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="timeline-${timestamp}.json"`,
    },
  });
};
