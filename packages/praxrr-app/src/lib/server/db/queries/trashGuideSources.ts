import { db } from '../db.ts';
import { parseTrashGuideSourceArrType, type TrashGuideSourceArrType } from '$lib/server/trashguide/types.ts';

const DEFAULT_BRANCH = 'master';
const DEFAULT_SCORE_PROFILE = 'default';

export interface TrashGuideSource {
  id: number;
  name: string;
  repository_url: string;
  branch: string;
  local_path: string;
  arr_type: TrashGuideSourceArrType;
  score_profile: string;
  sync_strategy: number;
  auto_pull: number;
  enabled: number;
  last_synced_at: string | null;
  last_commit_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface TrashGuideSourceRow {
  id: number;
  name: string;
  repository_url: string;
  branch: string;
  local_path: string;
  arr_type: string;
  score_profile: string;
  sync_strategy: number;
  auto_pull: number;
  enabled: number;
  last_synced_at: string | null;
  last_commit_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTrashGuideSourceInput {
  name: string;
  repositoryUrl: string;
  branch?: string;
  localPath: string;
  arrType: TrashGuideSourceArrType;
  scoreProfile?: string;
  syncStrategy?: number;
  autoPull?: boolean;
  enabled?: boolean;
}

export interface UpdateTrashGuideSourceInput {
  name?: string;
  repositoryUrl?: string;
  branch?: string;
  localPath?: string;
  arrType?: TrashGuideSourceArrType;
  scoreProfile?: string;
  syncStrategy?: number;
  autoPull?: boolean;
  enabled?: boolean;
  lastSyncedAt?: string | null;
  lastCommitHash?: string | null;
}

const sourceSelect = `
  SELECT
    id,
    name,
    repository_url,
    branch,
    local_path,
    arr_type,
    score_profile,
    sync_strategy,
    auto_pull,
    enabled,
    last_synced_at,
    last_commit_hash,
    created_at,
    updated_at
  FROM trash_guide_sources`;

function toDbBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function rowToSource(row: TrashGuideSourceRow): TrashGuideSource {
  return {
    id: row.id,
    name: row.name,
    repository_url: row.repository_url,
    branch: row.branch,
    local_path: row.local_path,
    arr_type: parseTrashGuideSourceArrType(row.arr_type),
    score_profile: row.score_profile,
    sync_strategy: row.sync_strategy,
    auto_pull: row.auto_pull,
    enabled: row.enabled,
    last_synced_at: row.last_synced_at,
    last_commit_hash: row.last_commit_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * All queries for trash_guide_sources table
 */
export const trashGuideSourcesQueries = {
  /**
   * Create a new TRaSH source
   */
  create(input: CreateTrashGuideSourceInput): number {
    const branch = input.branch ?? DEFAULT_BRANCH;
    const scoreProfile = input.scoreProfile ?? DEFAULT_SCORE_PROFILE;
    const syncStrategy = input.syncStrategy ?? 0;
    const autoPull = toDbBoolean(input.autoPull ?? false);
    const enabled = input.enabled !== false ? toDbBoolean(true) : toDbBoolean(false);

    db.beginTransaction();
    try {
      db.execute(
        `INSERT INTO trash_guide_sources (
          name,
          repository_url,
          branch,
          local_path,
          arr_type,
          score_profile,
          sync_strategy,
          auto_pull,
          enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.name,
        input.repositoryUrl,
        branch,
        input.localPath,
        input.arrType,
        scoreProfile,
        syncStrategy,
        autoPull,
        enabled
      );

      const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
      const id = result?.id ?? 0;
      if (!id) {
        throw new Error('Failed to create TRaSH source');
      }

      db.commit();
      return id;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Get a TRaSH source by ID
   */
  getById(id: number): TrashGuideSource | undefined {
    const row = db.queryFirst<TrashGuideSourceRow>(`${sourceSelect} WHERE id = ? LIMIT 1`, id);
    return row ? rowToSource(row) : undefined;
  },

  /**
   * Get a TRaSH source by name
   */
  getByName(name: string): TrashGuideSource | undefined {
    const row = db.queryFirst<TrashGuideSourceRow>(`${sourceSelect} WHERE name = ? ORDER BY id LIMIT 1`, name);
    return row ? rowToSource(row) : undefined;
  },

  /**
   * Get all TRaSH sources
   */
  getAll(): TrashGuideSource[] {
    return db.query<TrashGuideSourceRow>(`${sourceSelect} ORDER BY name`).map(rowToSource);
  },

  /**
   * Get all TRaSH sources by Arr type
   */
  getByArrType(arrType: TrashGuideSourceArrType): TrashGuideSource[] {
    return db.query<TrashGuideSourceRow>(`${sourceSelect} WHERE arr_type = ? ORDER BY name`, arrType).map(rowToSource);
  },

  /**
   * Get enabled TRaSH sources
   */
  getEnabled(): TrashGuideSource[] {
    return db.query<TrashGuideSourceRow>(`${sourceSelect} WHERE enabled = 1 ORDER BY name`).map(rowToSource);
  },

  /**
   * Get TRaSH sources due for auto sync
   */
  getDueForSync(): TrashGuideSource[] {
    return db
      .query<TrashGuideSourceRow>(
        `${sourceSelect}
       WHERE enabled = 1
       AND sync_strategy > 0
       AND (
         last_synced_at IS NULL
         OR datetime(replace(replace(last_synced_at, 'T', ' '), 'Z', ''), '+' || sync_strategy || ' minutes') <= datetime('now')
       )
       ORDER BY last_synced_at ASC NULLS FIRST`
      )
      .map(rowToSource);
  },

  /**
   * Update a TRaSH source
   */
  update(id: number, input: UpdateTrashGuideSourceInput): boolean {
    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.repositoryUrl !== undefined) {
      updates.push('repository_url = ?');
      params.push(input.repositoryUrl);
    }
    if (input.branch !== undefined) {
      updates.push('branch = ?');
      params.push(input.branch);
    }
    if (input.localPath !== undefined) {
      updates.push('local_path = ?');
      params.push(input.localPath);
    }
    if (input.arrType !== undefined) {
      updates.push('arr_type = ?');
      params.push(input.arrType);
    }
    if (input.scoreProfile !== undefined) {
      updates.push('score_profile = ?');
      params.push(input.scoreProfile);
    }
    if (input.syncStrategy !== undefined) {
      updates.push('sync_strategy = ?');
      params.push(input.syncStrategy);
    }
    if (input.autoPull !== undefined) {
      updates.push('auto_pull = ?');
      params.push(toDbBoolean(input.autoPull));
    }
    if (input.enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(toDbBoolean(input.enabled));
    }
    if (input.lastSyncedAt !== undefined) {
      updates.push('last_synced_at = ?');
      params.push(input.lastSyncedAt);
    }
    if (input.lastCommitHash !== undefined) {
      updates.push('last_commit_hash = ?');
      params.push(input.lastCommitHash);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.beginTransaction();
    try {
      const affected = db.execute(`UPDATE trash_guide_sources SET ${updates.join(', ')} WHERE id = ?`, ...params);
      db.commit();
      return affected > 0;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Update sync metadata for a source
   */
  updateSyncMetadata(id: number, input: { lastSyncedAt?: string | null; lastCommitHash?: string | null }): boolean {
    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.lastSyncedAt !== undefined) {
      updates.push('last_synced_at = ?');
      params.push(input.lastSyncedAt);
    }

    if (input.lastCommitHash !== undefined) {
      updates.push('last_commit_hash = ?');
      params.push(input.lastCommitHash);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.beginTransaction();
    try {
      const affected = db.execute(`UPDATE trash_guide_sources SET ${updates.join(', ')} WHERE id = ?`, ...params);
      db.commit();
      return affected > 0;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Touch last_synced_at to current timestamp
   */
  markSynced(id: number): boolean {
    db.beginTransaction();
    try {
      const affected = db.execute(
        'UPDATE trash_guide_sources SET last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        id
      );
      db.commit();
      return affected > 0;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Delete a TRaSH source
   */
  delete(id: number): boolean {
    const affected = db.execute('DELETE FROM trash_guide_sources WHERE id = ?', id);
    return affected > 0;
  },

  /**
   * Check if a TRaSH source name already exists
   */
  nameExists(name: string, excludeId?: number): boolean {
    if (excludeId !== undefined) {
      const result = db.queryFirst<{ count: number }>(
        'SELECT COUNT(*) as count FROM trash_guide_sources WHERE name = ? AND id != ?',
        name,
        excludeId
      );
      return (result?.count ?? 0) > 0;
    }

    const result = db.queryFirst<{ count: number }>(
      'SELECT COUNT(*) as count FROM trash_guide_sources WHERE name = ?',
      name
    );
    return (result?.count ?? 0) > 0;
  },
};
