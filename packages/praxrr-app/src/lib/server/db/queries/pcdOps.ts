import { db } from '../db.ts';
import { recordCreatedOpId, type CreatedOpRecord } from '../opCreationRecorder.ts';

export type PcdOpOrigin = 'base' | 'user';
export type PcdOpState = 'published' | 'draft' | 'superseded' | 'dropped' | 'orphaned';
export type PcdOpSource = 'repo' | 'local' | 'import';

export interface PcdOp {
  id: number;
  database_id: number;
  origin: PcdOpOrigin;
  state: PcdOpState;
  source: PcdOpSource;
  filename: string | null;
  op_number: number | null;
  sequence: number | null;
  sql: string;
  metadata: string | null;
  desired_state: string | null;
  content_hash: string | null;
  last_seen_in_repo_at: string | null;
  superseded_by_op_id: number | null;
  pushed_at: string | null;
  pushed_commit: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePcdOpInput {
  databaseId: number;
  origin: PcdOpOrigin;
  state: PcdOpState;
  source: PcdOpSource;
  sql: string;
  filename?: string | null;
  opNumber?: number | null;
  sequence?: number | null;
  metadata?: string | null;
  desiredState?: string | null;
  contentHash?: string | null;
  lastSeenInRepoAt?: string | null;
  supersededByOpId?: number | null;
  pushedAt?: string | null;
  pushedCommit?: string | null;
}

export async function buildContentHash(sql: string, metadataJson: string | null): Promise<string> {
  // Shared writer/import hash path for deterministic content identity.
  const payload = `${sql}\n${metadataJson ?? ''}`;
  const data = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface UpdatePcdOpInput {
  state?: PcdOpState;
  source?: PcdOpSource;
  filename?: string | null;
  opNumber?: number | null;
  sequence?: number | null;
  sql?: string;
  metadata?: string | null;
  desiredState?: string | null;
  contentHash?: string | null;
  lastSeenInRepoAt?: string | null;
  supersededByOpId?: number | null;
  pushedAt?: string | null;
  pushedCommit?: string | null;
}

export interface ListPcdOpsOptions {
  states?: PcdOpState[];
  source?: PcdOpSource;
}

/**
 * Metadata key marking an export batch op (written by the exporter). The YAML import never
 * re-sees these ops, so `markBaseOrphaned` must skip them (YAN-463).
 */
export const EXPORT_BATCH_METADATA_KEY = 'export_batch';

function chunkIds(ids: ReadonlyArray<number>): number[][] {
  const chunks: number[][] = [];
  const uniqueIds = [...new Set(ids)];
  for (let i = 0; i < uniqueIds.length; i += 400) chunks.push(uniqueIds.slice(i, i + 400));
  return chunks;
}

export const pcdOpsQueries = {
  create(input: CreatePcdOpInput): number {
    db.execute(
      `INSERT INTO pcd_ops (
				database_id, origin, state, source,
				filename, op_number, sequence,
				sql, metadata, desired_state,
				content_hash, last_seen_in_repo_at,
				superseded_by_op_id, pushed_at, pushed_commit
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.databaseId,
      input.origin,
      input.state,
      input.source,
      input.filename ?? null,
      input.opNumber ?? null,
      input.sequence ?? null,
      input.sql,
      input.metadata ?? null,
      input.desiredState ?? null,
      input.contentHash ?? null,
      input.lastSeenInRepoAt ?? null,
      input.supersededByOpId ?? null,
      input.pushedAt ?? null,
      input.pushedCommit ?? null
    );

    const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
    const id = result?.id ?? 0;
    recordCreatedOpId(id);
    return id;
  },

  getById(id: number): PcdOp | undefined {
    return db.queryFirst<PcdOp>('SELECT * FROM pcd_ops WHERE id = ?', id);
  },

  listByDatabase(databaseId: number, origin?: PcdOpOrigin): PcdOp[] {
    if (origin) {
      return db.query<PcdOp>(
        'SELECT * FROM pcd_ops WHERE database_id = ? AND origin = ? ORDER BY id',
        databaseId,
        origin
      );
    }
    return db.query<PcdOp>('SELECT * FROM pcd_ops WHERE database_id = ? ORDER BY id', databaseId);
  },

  listByDatabaseAndOrigin(databaseId: number, origin: PcdOpOrigin, options?: ListPcdOpsOptions): PcdOp[] {
    const clauses = ['database_id = ?', 'origin = ?'];
    const params: Array<string | number> = [databaseId, origin];

    if (options?.source) {
      clauses.push('source = ?');
      params.push(options.source);
    }

    if (options?.states && options.states.length > 0) {
      const placeholders = options.states.map(() => '?').join(', ');
      clauses.push(`state IN (${placeholders})`);
      params.push(...options.states);
    }

    const where = clauses.join(' AND ');
    return db.query<PcdOp>(`SELECT * FROM pcd_ops WHERE ${where} ORDER BY id`, ...params);
  },

  getBaseByFilename(databaseId: number, filename: string): PcdOp | undefined {
    return db.queryFirst<PcdOp>(
      "SELECT * FROM pcd_ops WHERE database_id = ? AND origin = 'base' AND filename = ?",
      databaseId,
      filename
    );
  },

  update(id: number, input: UpdatePcdOpInput): boolean {
    const updates: string[] = [];
    const params: Array<string | number | null> = [];

    if (input.state !== undefined) {
      updates.push('state = ?');
      params.push(input.state);
    }
    if (input.source !== undefined) {
      updates.push('source = ?');
      params.push(input.source);
    }
    if (input.filename !== undefined) {
      updates.push('filename = ?');
      params.push(input.filename ?? null);
    }
    if (input.opNumber !== undefined) {
      updates.push('op_number = ?');
      params.push(input.opNumber ?? null);
    }
    if (input.sequence !== undefined) {
      updates.push('sequence = ?');
      params.push(input.sequence ?? null);
    }
    if (input.sql !== undefined) {
      updates.push('sql = ?');
      params.push(input.sql);
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      params.push(input.metadata ?? null);
    }
    if (input.desiredState !== undefined) {
      updates.push('desired_state = ?');
      params.push(input.desiredState ?? null);
    }
    if (input.contentHash !== undefined) {
      updates.push('content_hash = ?');
      params.push(input.contentHash ?? null);
    }
    if (input.lastSeenInRepoAt !== undefined) {
      updates.push('last_seen_in_repo_at = ?');
      params.push(input.lastSeenInRepoAt ?? null);
    }
    if (input.supersededByOpId !== undefined) {
      updates.push('superseded_by_op_id = ?');
      params.push(input.supersededByOpId ?? null);
    }
    if (input.pushedAt !== undefined) {
      updates.push('pushed_at = ?');
      params.push(input.pushedAt ?? null);
    }
    if (input.pushedCommit !== undefined) {
      updates.push('pushed_commit = ?');
      params.push(input.pushedCommit ?? null);
    }

    if (updates.length === 0) return false;

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const affected = db.execute(`UPDATE pcd_ops SET ${updates.join(', ')} WHERE id = ?`, ...params);
    return affected > 0;
  },

  /**
   * Orphan repo base ops the import did not re-see. Export batch ops (JSON `true` under
   * `EXPORT_BATCH_METADATA_KEY`) are exempt (YAN-463); NULL/malformed metadata stays
   * sweepable and the `json_valid` guard keeps it from throwing.
   */
  markBaseOrphaned(databaseId: number, seenAt: string): number {
    return db.execute(
      `UPDATE pcd_ops
       SET state = 'orphaned', updated_at = CURRENT_TIMESTAMP
       WHERE database_id = ?
         AND origin = 'base'
         AND source = 'repo'
         AND (last_seen_in_repo_at IS NULL OR last_seen_in_repo_at < ?)
         AND (CASE WHEN json_valid(metadata) THEN json_extract(metadata, ?) ELSE NULL END) IS NOT 1`,
      databaseId,
      seenAt,
      `$.${EXPORT_BATCH_METADATA_KEY}`
    );
  },

  /**
   * Roll back a failed import (YAN-463/YAN-466). Fully synchronous, one SAVEPOINT.
   *
   * Guarantee: every pre-import row of `databaseId` in `snapshot` is restored column-for-column
   * (including `updated_at`; `created_at` is never touched), and only the ops/history rows that
   * were created inside the import's async context (recorded in `created`) are deleted.
   * Unrelated concurrent inserts survive; concurrent updates to snapshot rows made while the
   * import ran are reverted (per-PCD mutex follow-up: YAN-747). Throws (after rolling the
   * savepoint back) if a snapshot row no longer exists. The caller must invalidate the PCD cache.
   */
  restoreImportSnapshot(databaseId: number, snapshot: ReadonlyArray<PcdOp>, created: CreatedOpRecord): void {
    const opChunks = chunkIds(created.opIds);
    const historyChunks = chunkIds(created.historyIds);
    const inList = (ids: number[]) => ids.map(() => '?').join(', ');

    db.exec('SAVEPOINT pcd_import_restore');
    try {
      // 1. Restore snapshot rows verbatim (do not use update(): it stamps updated_at).
      const restoreRow = db.prepare(
        `UPDATE pcd_ops SET
           origin = ?, state = ?, source = ?, filename = ?, op_number = ?, sequence = ?,
           sql = ?, metadata = ?, desired_state = ?, content_hash = ?,
           last_seen_in_repo_at = ?, superseded_by_op_id = ?, pushed_at = ?, pushed_commit = ?,
           updated_at = ?
         WHERE id = ? AND database_id = ?`
      );
      try {
        for (const row of snapshot) {
          if (row.database_id !== databaseId) continue;
          const restored = restoreRow.run(
            row.origin,
            row.state,
            row.source,
            row.filename,
            row.op_number,
            row.sequence,
            row.sql,
            row.metadata,
            row.desired_state,
            row.content_hash,
            row.last_seen_in_repo_at,
            row.superseded_by_op_id,
            row.pushed_at,
            row.pushed_commit,
            row.updated_at,
            row.id,
            databaseId
          );
          // A vanished snapshot row cannot be restored; fail rather than claim exactness.
          if (restored === 0) throw new Error(`Snapshot op ${row.id} no longer exists; cannot restore`);
        }
      } finally {
        restoreRow.finalize();
      }

      // 2. Un-point rows from ops about to be deleted (self-FK is NO ACTION). Created rows
      // pointing at each other are also cleared; they are deleted in step 4 anyway.
      for (const chunk of opChunks) {
        db.execute(
          `UPDATE pcd_ops SET superseded_by_op_id = NULL
           WHERE database_id = ? AND superseded_by_op_id IN (${inList(chunk)})`,
          databaseId,
          ...chunk
        );
      }

      // 3. History first (op_id cascades anyway; explicit ids cover rows on surviving ops).
      for (const chunk of historyChunks) {
        db.execute(
          `DELETE FROM pcd_op_history WHERE database_id = ? AND id IN (${inList(chunk)})`,
          databaseId,
          ...chunk
        );
      }

      // 4. Created ops.
      for (const chunk of opChunks) {
        db.execute(`DELETE FROM pcd_ops WHERE database_id = ? AND id IN (${inList(chunk)})`, databaseId, ...chunk);
      }

      db.exec('RELEASE SAVEPOINT pcd_import_restore');
    } catch (error) {
      // Best-effort cleanup; never leave the savepoint open on the shared connection and
      // never let a cleanup failure mask the original error.
      try {
        db.exec('ROLLBACK TO SAVEPOINT pcd_import_restore');
      } catch {
        // fall through to RELEASE
      }
      try {
        db.exec('RELEASE SAVEPOINT pcd_import_restore');
      } catch {
        // nothing more to do
      }
      throw error;
    }
  },
};
