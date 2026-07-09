/**
 * Maps raw UNION-ALL feed rows into the normalized {@link TimelineEvent} envelope (issue #27):
 * a uniform ISO-8601 timestamp, a source-specific `metrics` bag, the badge colour, a one-line
 * title, and a deep-link into the owning feature's existing detail surface. Annotations are
 * attached from a batch-hydrated map keyed `${source}:${eventId}`.
 */

import { annotationKey } from '$db/queries/timelineAnnotations.ts';
import type { TimelineFeedRow } from '$db/queries/timelineFeed.ts';
import { statusBadge } from './status.ts';
import type {
  TimelineAnnotation,
  TimelineArrType,
  TimelineEvent,
  TimelineListResponse,
  TimelineScopeKind,
  TimelineSourceCounts,
  TimelineStatus,
} from './types.ts';

/**
 * Convert the normalized `occurred_at` sort key (`YYYY-MM-DD HH:MM:SS.SSS`, UTC) into a uniform
 * ISO-8601 UTC timestamp, so the API surface is dialect-agnostic regardless of which source (ISO
 * or space-form) produced the row.
 */
function toIso(occurredAt: string): string {
  return `${occurredAt.replace(' ', 'T')}Z`;
}

function drop<T extends Record<string, string | number | null>>(bag: T): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

function buildMetrics(row: TimelineFeedRow): Record<string, string | number | null> {
  switch (row.source) {
    case 'sync':
      return drop({
        itemsSynced: row.items_synced,
        failureCount: row.failure_count,
        entityChangeCount: row.entity_change_count,
        sectionsRun: row.sections_run,
      });
    case 'canary':
      return drop({
        canaryState: row.canary_state,
        canaryStatus: row.canary_status,
      });
    case 'snapshot':
      return drop({
        snapshotType: row.type,
        opsCountBase: row.ops_count_base,
        opsCountUser: row.ops_count_user,
        stateHash: row.state_hash,
      });
    case 'rollback':
      return drop({
        opsUndone: row.ops_undone,
        opsReactivated: row.ops_reactivated,
        stateHash: row.state_hash,
      });
  }
}

function buildTitle(row: TimelineFeedRow): string {
  const label = row.scope_label ?? 'unknown';
  switch (row.source) {
    case 'sync':
      return `Sync • ${label}`;
    case 'canary':
      return `Canary rollout • ${label}`;
    case 'snapshot':
      return `Snapshot • ${label}`;
    case 'rollback':
      return `Rollback • ${label}`;
  }
}

/**
 * Deep-link into the owning feature's existing detail surface (pure read layer — no new detail
 * endpoint). Rollback has no dedicated detail page, so it links to the owning database's
 * snapshot/rollback view.
 */
function buildDetailHref(row: TimelineFeedRow): string {
  switch (row.source) {
    case 'sync':
      return `/sync-history/${row.source_id}`;
    case 'canary':
      return `/canary/${row.source_id}`;
    case 'snapshot':
      return `/databases/${row.scope_id}/snapshots/${row.source_id}`;
    case 'rollback':
      return `/databases/${row.scope_id}/snapshots`;
  }
}

export function toTimelineEvent(row: TimelineFeedRow, annotations: TimelineAnnotation[]): TimelineEvent {
  const status = row.status as TimelineStatus;
  return {
    id: annotationKey(row.source, row.source_id),
    source: row.source,
    sourceId: row.source_id,
    timestamp: toIso(row.occurred_at),
    type: row.trigger,
    status,
    badge: statusBadge(status),
    scope: {
      kind: row.scope_kind as TimelineScopeKind,
      id: row.scope_id,
      label: row.scope_label,
      arrType: (row.arr_type as TimelineArrType | null) ?? null,
    },
    title: buildTitle(row),
    metrics: buildMetrics(row),
    detailHref: buildDetailHref(row),
    annotations,
  };
}

/** Map a page of feed rows into events, attaching batch-hydrated annotations. */
export function toTimelineEvents(
  rows: TimelineFeedRow[],
  annotationsByEvent: Map<string, TimelineAnnotation[]>
): TimelineEvent[] {
  return rows.map((row) =>
    toTimelineEvent(row, annotationsByEvent.get(annotationKey(row.source, row.source_id)) ?? [])
  );
}

export function buildTimelineListResponse(
  items: TimelineEvent[],
  opts: { page: number; pageSize: number; total: number; sourceCounts: TimelineSourceCounts }
): TimelineListResponse {
  const totalPages = opts.pageSize > 0 ? Math.ceil(opts.total / opts.pageSize) : 0;
  return {
    items,
    page: opts.page,
    pageSize: opts.pageSize,
    totalRecords: opts.total,
    totalPages,
    hasNext: opts.page < totalPages,
    sourceCounts: opts.sourceCounts,
  };
}
