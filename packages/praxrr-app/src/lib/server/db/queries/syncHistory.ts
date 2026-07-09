import { db } from '../db.ts';
import type {
  SyncEntityChange,
  SyncHistoryInput,
  SyncOperationStatus,
  SyncPreviewArrType,
  SyncPreviewSection,
  SyncSectionResult,
  SyncTrigger,
  SyncTriggerEvent,
} from '$sync/syncHistory/types.ts';

/**
 * Row shape for sync_history (byte-aligned to the migration columns).
 */
export interface SyncHistoryRow {
  id: number;
  arr_instance_id: number | null;
  instance_name: string;
  arr_type: string;
  job_id: number | null;
  trigger: string;
  trigger_event: string | null;
  sections_attempted: string;
  status: string;
  sections_run: number;
  items_synced: number;
  failure_count: number;
  entity_change_count: number;
  section_results: string;
  changes: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * Parsed, camelCased list-row summary (the heavy `changes` / `section_results`
 * JSON blobs are NOT decoded — list views only need counts).
 */
export interface SyncHistorySummary {
  id: number;
  arrInstanceId: number | null;
  instanceName: string;
  arrType: SyncPreviewArrType;
  jobId: number | null;
  trigger: SyncTrigger;
  triggerEvent: SyncTriggerEvent | null;
  sectionsAttempted: SyncPreviewSection[];
  status: SyncOperationStatus;
  sectionsRun: number;
  itemsSynced: number;
  failureCount: number;
  entityChangeCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

/**
 * Full detail — summary plus the decoded `section_results` and `changes` blobs.
 */
export interface SyncHistoryDetail extends SyncHistorySummary {
  sectionResults: SyncSectionResult[];
  changes: SyncEntityChange[];
}

/**
 * Filters shared by {@link search}, {@link count}, and {@link searchAll}. Every
 * field is optional; omitted fields do not constrain the query.
 */
export interface SyncHistoryFilters {
  instanceId?: number;
  arrType?: string;
  status?: string;
  trigger?: string;
  section?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface Pagination {
  limit: number;
  offset: number;
}

const SUMMARY_COLUMNS = `id, arr_instance_id, instance_name, arr_type, job_id, trigger, trigger_event,
	sections_attempted, status, sections_run, items_synced, failure_count, entity_change_count,
	error, started_at, finished_at, duration_ms, created_at`;

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function rowToSummary(row: SyncHistoryRow): SyncHistorySummary {
  return {
    id: row.id,
    arrInstanceId: row.arr_instance_id,
    instanceName: row.instance_name,
    arrType: row.arr_type as SyncPreviewArrType,
    jobId: row.job_id,
    trigger: row.trigger as SyncTrigger,
    triggerEvent: (row.trigger_event as SyncTriggerEvent | null) ?? null,
    sectionsAttempted: parseJsonArray<SyncPreviewSection>(row.sections_attempted),
    status: row.status as SyncOperationStatus,
    sectionsRun: row.sections_run,
    itemsSynced: row.items_synced,
    failureCount: row.failure_count,
    entityChangeCount: row.entity_change_count,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

function rowToDetail(row: SyncHistoryRow): SyncHistoryDetail {
  return {
    ...rowToSummary(row),
    sectionResults: parseJsonArray<SyncSectionResult>(row.section_results),
    changes: parseJsonArray<SyncEntityChange>(row.changes),
  };
}

/**
 * Build the shared WHERE clause + bound params from filters. Fed to BOTH `search`
 * and `count` so pagination totals never diverge from the returned rows.
 *
 * Date-range and retention compares wrap the ISO `started_at` in `datetime(...)`
 * because bookkeeping columns emit `CURRENT_TIMESTAMP` (no `T`/`Z`).
 */
function buildWhere(filters: SyncHistoryFilters): { clause: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.instanceId !== undefined) {
    conditions.push('arr_instance_id = ?');
    params.push(filters.instanceId);
  }
  if (filters.arrType) {
    conditions.push('arr_type = ?');
    params.push(filters.arrType);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.trigger) {
    conditions.push('trigger = ?');
    params.push(filters.trigger);
  }
  if (filters.section) {
    // sections_attempted is a JSON array of quoted section keys; match the quoted
    // token to avoid partial-name collisions.
    conditions.push('sections_attempted LIKE ?');
    params.push(`%"${filters.section}"%`);
  }
  if (filters.from) {
    conditions.push('datetime(started_at) >= datetime(?)');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('datetime(started_at) <= datetime(?)');
    params.push(filters.to);
  }
  if (filters.q) {
    conditions.push('(instance_name LIKE ? OR error LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { clause, params };
}

/**
 * All queries for sync_history (append-only audit trail).
 */
export const syncHistoryQueries = {
  /**
   * Append one audit row. Returns the new row id.
   *
   * Deliberately a bare `db.execute` (no `db.transaction`): a single INSERT is
   * statement-atomic, and the recorder runs inside the sync path which may already
   * hold a transaction — a nested bare `BEGIN` is not re-entrancy-safe.
   */
  insert(input: SyncHistoryInput): number {
    db.execute(
      `INSERT INTO sync_history (
				arr_instance_id, instance_name, arr_type, job_id, trigger, trigger_event,
				sections_attempted, status, sections_run, items_synced, failure_count,
				entity_change_count, section_results, changes, error,
				started_at, finished_at, duration_ms
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.arrInstanceId,
      input.instanceName,
      input.arrType,
      input.jobId,
      input.trigger,
      input.triggerEvent,
      JSON.stringify(input.sectionsAttempted),
      input.status,
      input.sectionsRun,
      input.itemsSynced,
      input.failureCount,
      input.changes.length,
      JSON.stringify(input.sectionResults),
      JSON.stringify(input.changes),
      input.error,
      input.startedAt,
      input.finishedAt,
      input.durationMs
    );
    const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
    return row?.id ?? 0;
  },

  /** Full detail for a single run, or undefined if unknown. */
  getById(id: number): SyncHistoryDetail | undefined {
    const row = db.queryFirst<SyncHistoryRow>('SELECT * FROM sync_history WHERE id = ?', id);
    return row ? rowToDetail(row) : undefined;
  },

  /** Filtered, paginated list of summaries, newest first (stable id tiebreak). */
  search(filters: SyncHistoryFilters, page: Pagination): SyncHistorySummary[] {
    const { clause, params } = buildWhere(filters);
    const rows = db.query<SyncHistoryRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM sync_history ${clause}
			ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
      ...params,
      page.limit,
      page.offset
    );
    return rows.map(rowToSummary);
  },

  /** Total rows matching the filters (shares buildWhere with `search`). */
  count(filters: SyncHistoryFilters): number {
    const { clause, params } = buildWhere(filters);
    const result = db.queryFirst<{ count: number }>(`SELECT COUNT(*) AS count FROM sync_history ${clause}`, ...params);
    return result?.count ?? 0;
  },

  /**
   * Filtered full-detail rows for export (no pagination; bounded by `cap` to guard
   * memory). Newest first.
   */
  searchAll(filters: SyncHistoryFilters, cap = 50000): SyncHistoryDetail[] {
    const { clause, params } = buildWhere(filters);
    const rows = db.query<SyncHistoryRow>(
      `SELECT * FROM sync_history ${clause} ORDER BY started_at DESC, id DESC LIMIT ?`,
      ...params,
      cap
    );
    return rows.map(rowToDetail);
  },

  /** Delete rows older than `days`. Returns rows deleted. */
  pruneOlderThan(days: number): number {
    return db.execute(
      `DELETE FROM sync_history WHERE datetime(started_at) < datetime('now', '-' || ? || ' days')`,
      days
    );
  },

  /**
   * Keep only the newest `max` rows; delete the rest. `max <= 0` disables the cap
   * (age-only retention) and is a no-op. Returns rows deleted.
   */
  pruneBeyondMaxEntries(max: number): number {
    if (max <= 0) {
      return 0;
    }
    return db.execute(
      `DELETE FROM sync_history
			WHERE id NOT IN (SELECT id FROM sync_history ORDER BY started_at DESC, id DESC LIMIT ?)`,
      max
    );
  },
};
