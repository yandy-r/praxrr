import { db } from '../db.ts';

/**
 * Append-only audit log for executed Point-in-Time Restores (issue #16).
 * One row per rollback; never updated except to flip status to 'failed' on a post-verify
 * failure. Mirrors the syncHistoryQueries/pcdSnapshotQueries raw-SQL query-module shape.
 */

export type PcdRollbackStatus = 'success' | 'failed';

/** Raw snake_case row shape for the pcd_rollbacks table. */
export interface PcdRollbackRow {
  id: number;
  database_id: number;
  snapshot_id: number | null;
  pre_rollback_snapshot_id: number | null;
  target_state_hash: string | null;
  ops_undone: number;
  ops_reactivated: number;
  status: PcdRollbackStatus;
  error: string | null;
  created_at: string;
}

/** CamelCase API/domain shape for a single rollback record. */
export interface PcdRollbackDetail {
  id: number;
  databaseId: number;
  snapshotId: number | null;
  preRollbackSnapshotId: number | null;
  targetStateHash: string | null;
  opsUndone: number;
  opsReactivated: number;
  status: PcdRollbackStatus;
  error: string | null;
  createdAt: string;
}

export interface InsertRollbackInput {
  databaseId: number;
  snapshotId: number | null;
  preRollbackSnapshotId: number | null;
  targetStateHash: string | null;
  opsUndone: number;
  opsReactivated: number;
  status: PcdRollbackStatus;
  error?: string | null;
}

export interface PcdRollbackListOptions {
  limit?: number;
  offset?: number;
}

export interface PcdRollbackListResponse {
  rollbacks: PcdRollbackDetail[];
  total: number;
}

const DEFAULT_LIMIT = 50;

function rowToDetail(row: PcdRollbackRow): PcdRollbackDetail {
  return {
    id: row.id,
    databaseId: row.database_id,
    snapshotId: row.snapshot_id,
    preRollbackSnapshotId: row.pre_rollback_snapshot_id,
    targetStateHash: row.target_state_hash,
    opsUndone: row.ops_undone,
    opsReactivated: row.ops_reactivated,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

export const rollbackQueries = {
  insert(input: InsertRollbackInput): number {
    db.execute(
      `INSERT INTO pcd_rollbacks (
				database_id, snapshot_id, pre_rollback_snapshot_id,
				target_state_hash, ops_undone, ops_reactivated, status, error
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.databaseId,
      input.snapshotId,
      input.preRollbackSnapshotId,
      input.targetStateHash,
      input.opsUndone,
      input.opsReactivated,
      input.status,
      input.error ?? null
    );

    const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
    return result?.id ?? 0;
  },

  updateStatus(id: number, status: PcdRollbackStatus, error: string | null): boolean {
    const affected = db.execute('UPDATE pcd_rollbacks SET status = ?, error = ? WHERE id = ?', status, error, id);
    return affected > 0;
  },

  getById(id: number): PcdRollbackDetail | undefined {
    const row = db.queryFirst<PcdRollbackRow>('SELECT * FROM pcd_rollbacks WHERE id = ?', id);
    return row ? rowToDetail(row) : undefined;
  },

  listByDatabase(databaseId: number, options?: PcdRollbackListOptions): PcdRollbackListResponse {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const offset = options?.offset ?? 0;

    const totalResult = db.queryFirst<{ count: number }>(
      'SELECT COUNT(*) as count FROM pcd_rollbacks WHERE database_id = ?',
      databaseId
    );

    const rows = db.query<PcdRollbackRow>(
      `SELECT * FROM pcd_rollbacks
			WHERE database_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ? OFFSET ?`,
      databaseId,
      limit,
      offset
    );

    return {
      rollbacks: rows.map(rowToDetail),
      total: totalResult?.count ?? 0,
    };
  },
};
