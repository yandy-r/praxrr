/**
 * Timeline read service (issue #27): assembles the merged feed page (or full export) from the
 * UNION-ALL query module, hydrates annotations for just the returned events, and maps rows into
 * the normalized envelope. Pure read layer — it never writes to any source table.
 */

import { timelineFeedQueries } from '$db/queries/timelineFeed.ts';
import { timelineAnnotationQueries } from '$db/queries/timelineAnnotations.ts';
import { buildTimelineListResponse, toTimelineEvents } from './responses.ts';
import type { TimelineEvent, TimelineFilters, TimelineListResponse } from './types.ts';
import type { TimelineFeedRow } from '$db/queries/timelineFeed.ts';

function annotationRefs(rows: TimelineFeedRow[]): { source: TimelineFeedRow['source']; eventId: number }[] {
  return rows.map((r) => ({ source: r.source, eventId: r.source_id }));
}

export function listTimeline(
  filters: TimelineFilters,
  pagination: { page: number; pageSize: number }
): TimelineListResponse {
  // sourceCounts is computed over the same included branches + WHERE/params as the feed, so its
  // sum IS the total — deriving it here avoids a second, redundant full-union COUNT scan.
  // (timelineFeedQueries.count remains and is covered directly by the query-module tests.)
  const sourceCounts = timelineFeedQueries.sourceCounts(filters);
  const total = Object.values(sourceCounts).reduce((sum, count) => sum + count, 0);
  const rows = timelineFeedQueries.search(filters, {
    limit: pagination.pageSize,
    offset: (pagination.page - 1) * pagination.pageSize,
  });
  const annotationsByEvent = timelineAnnotationQueries.listForEvents(annotationRefs(rows));
  const items = toTimelineEvents(rows, annotationsByEvent);
  return buildTimelineListResponse(items, {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    sourceCounts,
  });
}

export function exportTimeline(filters: TimelineFilters, cap = 50000): TimelineEvent[] {
  const rows = timelineFeedQueries.searchAll(filters, cap);
  const annotationsByEvent = timelineAnnotationQueries.listForEvents(annotationRefs(rows));
  return toTimelineEvents(rows, annotationsByEvent);
}
