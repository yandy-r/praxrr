import { db } from '../db.ts';
import type {
  PcdSnapshotRow,
  PcdSnapshotDetail,
  PcdSnapshotListResponse,
  PcdSnapshotListOptions,
  SnapshotType,
  SnapshotTrigger,
} from '$pcd/snapshots/types.ts';

type CreateManualSnapshotInsertInput = {
  databaseId: number;
  type: 'manual';
  // 'rollback' = a durable (never auto-pruned) pre-rollback capture taken before a restore
  // rewinds the op log, so the restore is itself reversible (issue #16).
  trigger: 'manual' | 'rollback';
  description?: string | null;
};

type CreateAutoSnapshotInput = {
  databaseId: number;
  type: 'auto';
  trigger: Exclude<SnapshotTrigger, 'manual'>;
  description?: string | null;
  targetInstanceIds?: number[] | null;
};

interface CreateSnapshotInputBase {
  opsSequenceMaxId: number;
  opsCountBase: number;
  opsCountUser: number;
  cacheStateHash?: string | null;
  /**
   * The exact published-op-id manifest captured at snapshot time (issue #16). Stored as a
   * JSON array so rollback reconstruction replays it verbatim instead of deriving membership
   * from mutable op-state columns. Omit/null for callers that never restore.
   */
  publishedOpIds?: number[] | null;
}

type CreateSnapshotInput = (CreateAutoSnapshotInput | CreateManualSnapshotInsertInput) & CreateSnapshotInputBase;

function parseTargetInstanceIds(targetInstanceIds: string | null): number[] | null {
  if (!targetInstanceIds) {
    return null;
  }

  try {
    const parsed = JSON.parse(targetInstanceIds);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((id): id is number => typeof id === 'number');
  } catch {
    return null;
  }
}

function toDetail(row: PcdSnapshotRow): PcdSnapshotDetail {
  return {
    id: row.id,
    databaseId: row.database_id,
    type: row.type,
    trigger: row.trigger,
    description: row.description,
    opsSequenceMaxId: row.ops_sequence_max_id,
    opsCountBase: row.ops_count_base,
    opsCountUser: row.ops_count_user,
    cacheStateHash: row.cache_state_hash,
    targetInstanceIds: parseTargetInstanceIds(row.target_instance_ids),
    createdAt: row.created_at,
  };
}

/**
 * All queries for pcd_snapshots table
 */
export const pcdSnapshotQueries = {
  /**
   * Create a new PCD snapshot
   */
  create(input: CreateSnapshotInput): PcdSnapshotDetail {
    const targetInstanceIds =
      input.type === 'auto' && input.targetInstanceIds ? JSON.stringify(input.targetInstanceIds) : null;
    const publishedOpIds = input.publishedOpIds ? JSON.stringify(input.publishedOpIds) : null;

    db.execute(
      `INSERT INTO pcd_snapshots (
				database_id, type, "trigger", description,
				ops_sequence_max_id, ops_count_base, ops_count_user,
				cache_state_hash, published_op_ids, target_instance_ids
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.databaseId,
      input.type,
      input.trigger,
      input.description ?? null,
      input.opsSequenceMaxId,
      input.opsCountBase,
      input.opsCountUser,
      input.cacheStateHash ?? null,
      publishedOpIds,
      targetInstanceIds
    );

    const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
    const id = result?.id ?? 0;
    if (!id) {
      throw new Error('Failed to create PCD snapshot');
    }

    const row = db.queryFirst<PcdSnapshotRow>('SELECT * FROM pcd_snapshots WHERE id = ?', id);
    if (!row) {
      throw new Error('Failed to retrieve created PCD snapshot');
    }

    return toDetail(row);
  },

  /**
   * Get a snapshot by ID
   */
  getById(id: number): PcdSnapshotDetail | undefined {
    const row = db.queryFirst<PcdSnapshotRow>('SELECT * FROM pcd_snapshots WHERE id = ?', id);
    return row ? toDetail(row) : undefined;
  },

  /**
   * Return the captured published-op-id manifest for a snapshot, or null when the snapshot
   * predates the manifest column (legacy, not restorable) or the JSON is unparseable.
   */
  getPublishedOpIds(id: number): number[] | null {
    const row = db.queryFirst<{ published_op_ids: string | null }>(
      'SELECT published_op_ids FROM pcd_snapshots WHERE id = ?',
      id
    );
    if (!row || row.published_op_ids === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(row.published_op_ids);
      if (!Array.isArray(parsed)) {
        return null;
      }
      return parsed.filter((value): value is number => typeof value === 'number');
    } catch {
      return null;
    }
  },

  /**
   * List snapshots for a database with optional filtering and pagination
   */
  listByDatabase(databaseId: number, options?: PcdSnapshotListOptions): PcdSnapshotListResponse {
    const conditions: string[] = ['database_id = ?'];
    const params: (string | number)[] = [databaseId];

    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const countResult = db.queryFirst<{ count: number }>(
      `SELECT COUNT(*) as count FROM pcd_snapshots ${whereClause}`,
      ...params
    );
    const total = countResult?.count ?? 0;

    const rows = db.query<PcdSnapshotRow>(
      `SELECT * FROM pcd_snapshots ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    );

    return {
      snapshots: rows.map(toDetail),
      total,
    };
  },

  /**
   * Count snapshots for a database with optional type filter
   */
  countByDatabase(databaseId: number, options?: { type?: SnapshotType }): number {
    const conditions: string[] = ['database_id = ?'];
    const params: (string | number)[] = [databaseId];

    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = db.queryFirst<{ count: number }>(
      `SELECT COUNT(*) as count FROM pcd_snapshots ${whereClause}`,
      ...params
    );

    return result?.count ?? 0;
  },

  /**
   * Get the most recent snapshot for a database
   */
  getLatestByDatabase(databaseId: number): PcdSnapshotDetail | undefined {
    const row = db.queryFirst<PcdSnapshotRow>(
      `SELECT * FROM pcd_snapshots WHERE database_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      databaseId
    );
    return row ? toDetail(row) : undefined;
  },

  /**
   * Delete a snapshot by ID
   */
  deleteById(id: number): boolean {
    const affected = db.execute('DELETE FROM pcd_snapshots WHERE id = ?', id);
    return affected > 0;
  },

  /**
   * Prune auto snapshots that exceed maxCount or are older than maxAgeDays.
   * Returns the total number of deleted rows.
   */
  pruneAutoSnapshots(databaseId: number, maxCount: number, maxAgeDays: number): number {
    let totalDeleted = 0;

    db.beginTransaction();
    try {
      // Delete auto snapshots older than maxAgeDays
      const deletedByAge = db.execute(
        `DELETE FROM pcd_snapshots
				WHERE database_id = ?
				AND type = 'auto'
				AND created_at < datetime('now', '-' || ? || ' days')`,
        databaseId,
        maxAgeDays
      );
      totalDeleted += deletedByAge;

      // Delete auto snapshots exceeding maxCount (keep newest N)
      const deletedByCount = db.execute(
        `DELETE FROM pcd_snapshots
				WHERE database_id = ?
				AND type = 'auto'
				AND id NOT IN (
					SELECT id FROM pcd_snapshots
					WHERE database_id = ?
					AND type = 'auto'
					ORDER BY created_at DESC, id DESC
					LIMIT ?
				)`,
        databaseId,
        databaseId,
        maxCount
      );
      totalDeleted += deletedByCount;

      db.commit();
    } catch (error) {
      db.rollback();
      throw error;
    }

    return totalDeleted;
  },
};
