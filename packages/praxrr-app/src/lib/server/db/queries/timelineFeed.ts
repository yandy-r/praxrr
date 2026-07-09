import { db } from '../db.ts';
import { canaryStatusCaseSql } from '$lib/server/timeline/status.ts';
import type { TimelineFilters, TimelineSource } from '$lib/server/timeline/types.ts';

/**
 * Read-only UNION-ALL feed over the four timeline event sources (issue #27).
 *
 * The Sync Archaeology Timeline never materializes events; it merges sync_history,
 * canary_rollouts, pcd_snapshots and pcd_rollbacks at query time. Each source is one UNION-ALL
 * branch projecting an identical column list, so SQLite performs the merge + ORDER BY +
 * LIMIT/OFFSET + COUNT in one place — the sync-history buildWhere/COUNT-sharing discipline
 * generalized to four heterogeneous tables.
 *
 * Sort key: `strftime('%Y-%m-%d %H:%M:%f', <ts>)` normalizes both timestamp dialects
 * (sync/canary write ISO-8601 `...Z`; snapshot/rollback default to space-form CURRENT_TIMESTAMP)
 * into one lexically-sortable ms-precision string. Range bounds use `datetime(...)` byte-identical
 * to syncHistory.buildWhere. Order `occurred_at DESC, source ASC, source_id DESC` is a
 * deterministic TOTAL order so same-second cross-source events never duplicate/skip across pages.
 *
 * The projected `status` column is the NORMALIZED status (so the badge and the `status` filter
 * agree); the raw canary lifecycle is surfaced separately as `canary_state`. `count` and
 * `sourceCounts` reuse the exact same included branches + WHERE clauses/params as `search`, so
 * page totals can never diverge from page rows.
 */

/** Raw UNION-ALL row (snake_case as returned by SQLite). Nullable superset; responses.ts packs the metrics bag. */
export interface TimelineFeedRow {
  source: TimelineSource;
  source_id: number;
  event_ts: string;
  occurred_at: string;
  scope_kind: 'arr-instance' | 'pcd-database';
  scope_id: number | null;
  scope_label: string | null;
  arr_type: string | null;
  type: string | null;
  status: string;
  items_synced: number | null;
  failure_count: number | null;
  entity_change_count: number | null;
  sections_run: number | null;
  ops_count_base: number | null;
  ops_count_user: number | null;
  ops_undone: number | null;
  ops_reactivated: number | null;
  canary_state: string | null;
  canary_status: string | null;
  trigger: string | null;
  state_hash: string | null;
}

export interface Pagination {
  limit: number;
  offset: number;
}

const CANARY_STATUS_EXPR = canaryStatusCaseSql('cr.status');

/**
 * Per-source projection. Column order/aliases are identical across arms so UNION ALL aligns by
 * position. `<statusExpr> AS status` is the normalized status; NULL where a source lacks a column.
 */
const PROJ_SYNC = `SELECT 'sync' AS source, sh.id AS source_id, sh.started_at AS event_ts,
	strftime('%Y-%m-%d %H:%M:%f', sh.started_at) AS occurred_at,
	'arr-instance' AS scope_kind, sh.arr_instance_id AS scope_id, sh.instance_name AS scope_label,
	sh.arr_type AS arr_type, NULL AS type, sh.status AS status,
	sh.items_synced AS items_synced, sh.failure_count AS failure_count,
	sh.entity_change_count AS entity_change_count, sh.sections_run AS sections_run,
	NULL AS ops_count_base, NULL AS ops_count_user, NULL AS ops_undone, NULL AS ops_reactivated,
	NULL AS canary_state, NULL AS canary_status, sh.trigger AS trigger, NULL AS state_hash`;

const PROJ_CANARY = `SELECT 'canary' AS source, cr.id AS source_id, cr.started_at AS event_ts,
	strftime('%Y-%m-%d %H:%M:%f', cr.started_at) AS occurred_at,
	'arr-instance' AS scope_kind, cr.canary_instance_id AS scope_id, cr.canary_instance_name AS scope_label,
	cr.arr_type AS arr_type, NULL AS type, ${CANARY_STATUS_EXPR} AS status,
	NULL AS items_synced, NULL AS failure_count, NULL AS entity_change_count, NULL AS sections_run,
	NULL AS ops_count_base, NULL AS ops_count_user, NULL AS ops_undone, NULL AS ops_reactivated,
	cr.status AS canary_state, cr.canary_status AS canary_status, cr.trigger AS trigger, NULL AS state_hash`;

const PROJ_SNAPSHOT = `SELECT 'snapshot' AS source, ps.id AS source_id, ps.created_at AS event_ts,
	strftime('%Y-%m-%d %H:%M:%f', ps.created_at) AS occurred_at,
	'pcd-database' AS scope_kind, ps.database_id AS scope_id, di.name AS scope_label,
	NULL AS arr_type, ps.type AS type, 'info' AS status,
	NULL AS items_synced, NULL AS failure_count, NULL AS entity_change_count, NULL AS sections_run,
	ps.ops_count_base AS ops_count_base, ps.ops_count_user AS ops_count_user,
	NULL AS ops_undone, NULL AS ops_reactivated,
	NULL AS canary_state, NULL AS canary_status, ps."trigger" AS trigger, ps.cache_state_hash AS state_hash`;

const PROJ_ROLLBACK = `SELECT 'rollback' AS source, pr.id AS source_id, pr.created_at AS event_ts,
	strftime('%Y-%m-%d %H:%M:%f', pr.created_at) AS occurred_at,
	'pcd-database' AS scope_kind, pr.database_id AS scope_id, di.name AS scope_label,
	NULL AS arr_type, NULL AS type, pr.status AS status,
	NULL AS items_synced, NULL AS failure_count, NULL AS entity_change_count, NULL AS sections_run,
	NULL AS ops_count_base, NULL AS ops_count_user, pr.ops_undone AS ops_undone, pr.ops_reactivated AS ops_reactivated,
	NULL AS canary_state, NULL AS canary_status, NULL AS trigger, pr.target_state_hash AS state_hash`;

interface ArmSpec {
  source: TimelineSource;
  projection: string;
  /** FROM (+ optional LEFT JOIN) for both the row projection and the count projection. */
  body: string;
  tsCol: string;
  /** Normalized-status SQL expression; shared by the projection and the status filter. */
  statusExpr: string;
  instanceCol?: string;
  databaseCol?: string;
  arrTypeCol?: string;
  qCols: string[];
}

const ARM_SPECS: readonly ArmSpec[] = [
  {
    source: 'sync',
    projection: PROJ_SYNC,
    body: 'FROM sync_history sh',
    tsCol: 'sh.started_at',
    statusExpr: 'sh.status',
    instanceCol: 'sh.arr_instance_id',
    arrTypeCol: 'sh.arr_type',
    qCols: ['sh.instance_name', 'sh.error'],
  },
  {
    source: 'canary',
    projection: PROJ_CANARY,
    body: 'FROM canary_rollouts cr',
    tsCol: 'cr.started_at',
    statusExpr: CANARY_STATUS_EXPR,
    instanceCol: 'cr.canary_instance_id',
    arrTypeCol: 'cr.arr_type',
    qCols: ['cr.canary_instance_name', 'cr.canary_error'],
  },
  {
    source: 'snapshot',
    projection: PROJ_SNAPSHOT,
    body: 'FROM pcd_snapshots ps LEFT JOIN database_instances di ON di.id = ps.database_id',
    tsCol: 'ps.created_at',
    statusExpr: `'info'`,
    databaseCol: 'ps.database_id',
    qCols: ['di.name', 'ps.description'],
  },
  {
    source: 'rollback',
    projection: PROJ_ROLLBACK,
    body: 'FROM pcd_rollbacks pr LEFT JOIN database_instances di ON di.id = pr.database_id',
    tsCol: 'pr.created_at',
    statusExpr: 'pr.status',
    databaseCol: 'pr.database_id',
    qCols: ['di.name', 'pr.error'],
  },
];

interface Arm {
  select: string;
  count: string;
  params: (string | number)[];
}

/**
 * Build one arm's row SELECT and count SELECT (which share the FROM/WHERE + params, guaranteeing
 * search/count parity). Predicate order is FROZEN and identical across arms — instance, database,
 * arrType, status, from, to, q — so `arms.flatMap(a => a.params)` lines up 1:1 with the `?` order.
 */
function buildArm(spec: ArmSpec, f: TimelineFilters): Arm {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (f.instanceId !== undefined && spec.instanceCol) {
    conditions.push(`${spec.instanceCol} = ?`);
    params.push(f.instanceId);
  }
  if (f.databaseId !== undefined && spec.databaseCol) {
    conditions.push(`${spec.databaseCol} = ?`);
    params.push(f.databaseId);
  }
  if (f.arrType && spec.arrTypeCol) {
    conditions.push(`${spec.arrTypeCol} = ?`);
    params.push(f.arrType);
  }
  if (f.status) {
    conditions.push(`(${spec.statusExpr}) = ?`);
    params.push(f.status);
  }
  if (f.from) {
    conditions.push(`datetime(${spec.tsCol}) >= datetime(?)`);
    params.push(f.from);
  }
  if (f.to) {
    conditions.push(`datetime(${spec.tsCol}) <= datetime(?)`);
    params.push(f.to);
  }
  if (f.q) {
    conditions.push(`(${spec.qCols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < spec.qCols.length; i++) params.push(`%${f.q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return {
    select: `${spec.projection}\n\t${spec.body}\n\t${where}`,
    count: `SELECT '${spec.source}' AS source\n\t${spec.body}\n\t${where}`,
    params,
  };
}

/**
 * Which arms participate given the scope axes. Fail-closed: contradictory axes (also rejected
 * with 400 upstream) drive the set empty. Preserves ARM_SPECS order for deterministic params.
 */
function selectArms(f: TimelineFilters): ArmSpec[] {
  let specs: ArmSpec[] = [...ARM_SPECS];
  const arrOnly = (s: ArmSpec) => s.source === 'sync' || s.source === 'canary';
  const pcdOnly = (s: ArmSpec) => s.source === 'snapshot' || s.source === 'rollback';

  if (f.instanceId !== undefined || f.arrType || f.scopeKind === 'arr-instance') {
    specs = specs.filter(arrOnly);
  }
  if (f.databaseId !== undefined || f.scopeKind === 'pcd-database') {
    specs = specs.filter(pcdOnly);
  }
  if (f.source && f.source.length > 0) {
    const wanted = new Set(f.source);
    specs = specs.filter((s) => wanted.has(s.source));
  }
  return specs;
}

const ORDER = 'ORDER BY occurred_at DESC, source ASC, source_id DESC';

const EMPTY_SOURCE_COUNTS: Record<TimelineSource, number> = {
  sync: 0,
  canary: 0,
  snapshot: 0,
  rollback: 0,
};

/** Source -> owning table. Fixed map (never user input) — safe to interpolate into SQL. */
const SOURCE_TABLE: Record<TimelineSource, string> = {
  sync: 'sync_history',
  canary: 'canary_rollouts',
  snapshot: 'pcd_snapshots',
  rollback: 'pcd_rollbacks',
};

export const timelineFeedQueries = {
  /** One merged, deterministically-ordered page. */
  search(filters: TimelineFilters, page: Pagination): TimelineFeedRow[] {
    const arms = selectArms(filters).map((s) => buildArm(s, filters));
    if (arms.length === 0) return [];
    const union = arms.map((a) => a.select).join('\n\tUNION ALL\n');
    const params = arms.flatMap((a) => a.params);
    return db.query<TimelineFeedRow>(
      `SELECT * FROM (\n${union}\n) ${ORDER} LIMIT ? OFFSET ?`,
      ...params,
      page.limit,
      page.offset
    );
  },

  /** Total over the SAME included arms + SAME WHEREs/params (minimal projection). */
  count(filters: TimelineFilters): number {
    const arms = selectArms(filters).map((s) => buildArm(s, filters));
    if (arms.length === 0) return 0;
    const union = arms.map((a) => a.count).join('\n\tUNION ALL\n');
    const params = arms.flatMap((a) => a.params);
    const row = db.queryFirst<{ count: number }>(`SELECT COUNT(*) AS count FROM (\n${union}\n)`, ...params);
    return row?.count ?? 0;
  },

  /** Per-source facet counts (zero-filled) over the same gated set. */
  sourceCounts(filters: TimelineFilters): Record<TimelineSource, number> {
    const out: Record<TimelineSource, number> = { ...EMPTY_SOURCE_COUNTS };
    const arms = selectArms(filters).map((s) => buildArm(s, filters));
    if (arms.length === 0) return out;
    const union = arms.map((a) => a.count).join('\n\tUNION ALL\n');
    const params = arms.flatMap((a) => a.params);
    const rows = db.query<{ source: TimelineSource; count: number }>(
      `SELECT source, COUNT(*) AS count FROM (\n${union}\n) GROUP BY source`,
      ...params
    );
    for (const r of rows) out[r.source] = r.count;
    return out;
  },

  /** Capped, unpaginated export drain in the same total order. */
  searchAll(filters: TimelineFilters, cap = 50000): TimelineFeedRow[] {
    const arms = selectArms(filters).map((s) => buildArm(s, filters));
    if (arms.length === 0) return [];
    const union = arms.map((a) => a.select).join('\n\tUNION ALL\n');
    const params = arms.flatMap((a) => a.params);
    return db.query<TimelineFeedRow>(`SELECT * FROM (\n${union}\n) ${ORDER} LIMIT ?`, ...params, cap);
  },

  /** Whether an event row still exists in its source table (annotation create-time guard). */
  eventExists(source: TimelineSource, eventId: number): boolean {
    const row = db.queryFirst<{ ok: number }>(`SELECT 1 AS ok FROM ${SOURCE_TABLE[source]} WHERE id = ?`, eventId);
    return row !== undefined;
  },
};
