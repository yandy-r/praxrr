/**
 * Shared contracts for the Sync Archaeology Timeline (issue #27).
 *
 * The timeline is a read/visual layer that merges four existing event sources into one
 * chronological feed; these types describe the normalized envelope the API returns and the
 * filter model the query layer consumes. They intentionally carry no DB or SvelteKit
 * dependency so both the query modules (`$db/queries/timelineFeed.ts`) and the route layer can
 * import them without a cycle.
 */

/** The event sources currently merged into the timeline feed. */
export type TimelineSource = 'sync' | 'canary' | 'snapshot' | 'rollback';

/** Which "instance" axis an event is scoped to. Arr-instance and PCD-database are distinct. */
export type TimelineScopeKind = 'arr-instance' | 'pcd-database';

/**
 * Normalized, cross-source status domain used for filtering and badge colour. Each source's
 * native status/lifecycle is mapped into this domain in one place (`status.ts`) so the UI never
 * has to know per-source semantics.
 */
export type TimelineStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'pending' | 'info';

/** Badge variant names exposed by the shared `Badge` component. */
export type TimelineBadge = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/** Arr family for arr-instance-scoped events; null for PCD-database-scoped events. */
export type TimelineArrType = 'radarr' | 'sonarr' | 'lidarr';

/**
 * Where an event happened. `id` is null when the underlying Arr instance was deleted (the
 * source FK is `ON DELETE SET NULL`) but `label` is retained from the denormalized name.
 */
export interface TimelineScope {
  kind: TimelineScopeKind;
  id: number | null;
  label: string | null;
  arrType: TimelineArrType | null;
}

/** A user note attached to a single timeline event (many per event form a thread). */
export interface TimelineAnnotation {
  id: number;
  source: TimelineSource;
  eventId: number;
  body: string;
  authorUserId: number | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single normalized timeline event. `id` is the stable composite `${source}:${sourceId}`
 * used as the UI key and the annotation reference key. `metrics` is a small, source-specific
 * bag of counts sufficient to render the row without a drill-down; `detailHref` deep-links into
 * the owning feature's existing detail surface.
 */
export interface TimelineEvent {
  id: string;
  source: TimelineSource;
  sourceId: number;
  timestamp: string;
  type: string | null;
  status: TimelineStatus;
  badge: TimelineBadge;
  scope: TimelineScope;
  title: string;
  metrics: Record<string, string | number | null>;
  detailHref: string;
  annotations: TimelineAnnotation[];
}

/** Per-source event counts over the same filtered/gated set (drives filter chips). */
export type TimelineSourceCounts = Record<TimelineSource, number>;

/** Paginated timeline feed envelope (byte-aligned to the sync-history list response). */
export interface TimelineListResponse {
  items: TimelineEvent[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
  sourceCounts: TimelineSourceCounts;
}

/**
 * Parsed, validated timeline filters. Scope axes are mutually exclusive: an `instanceId` or
 * `arrType` filter includes only the arr-instance sources (sync, canary); a `databaseId` filter
 * includes only the PCD-database sources (snapshot, rollback). `source` intersects whatever the
 * scope axis leaves included. `status`, `from`, `to`, `q` apply inside every included branch.
 */
export interface TimelineFilters {
  instanceId?: number;
  databaseId?: number;
  scopeKind?: TimelineScopeKind;
  arrType?: TimelineArrType;
  status?: TimelineStatus;
  source?: TimelineSource[];
  from?: string;
  to?: string;
  q?: string;
}
