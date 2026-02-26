import { db } from '../db.ts';
import {
  databaseInstanceCredentialsQueries,
  type DatabaseInstanceCredentialWriteInput,
} from './databaseInstanceCredentials.ts';

export type ConflictStrategy = 'override' | 'align' | 'ask';

/**
 * Types for database_instances table
 */
export interface DatabaseInstance {
  id: number;
  uuid: string;
  name: string;
  repository_url: string;
  local_path: string;
  sync_strategy: number;
  auto_pull: number;
  enabled: number;
  personal_access_token: string | null;
  has_personal_access_token?: number;
  is_private: number;
  local_ops_enabled: number;
  git_user_name: string | null;
  git_user_email: string | null;
  conflict_strategy: ConflictStrategy;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDatabaseInstanceInput {
  uuid: string;
  name: string;
  repositoryUrl: string;
  localPath: string;
  syncStrategy?: number;
  autoPull?: boolean;
  enabled?: boolean;
  personalAccessToken?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  isPrivate?: boolean;
  localOpsEnabled?: boolean;
  conflictStrategy?: ConflictStrategy;
}

export interface UpdateDatabaseInstanceInput {
  name?: string;
  repositoryUrl?: string;
  syncStrategy?: number;
  autoPull?: boolean;
  enabled?: boolean;
  personalAccessToken?: string;
  localOpsEnabled?: boolean;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
  conflictStrategy?: ConflictStrategy;
}

const databaseInstanceSelectWithCredentials = `
  SELECT
    di.id,
    di.uuid,
    di.name,
    di.repository_url,
    di.local_path,
    di.sync_strategy,
    di.auto_pull,
    di.enabled,
    '' AS personal_access_token,
    EXISTS(
      SELECT 1
      FROM database_instance_credentials dic
      WHERE dic.instance_id = di.id
    ) AS has_personal_access_token,
    di.is_private,
    di.local_ops_enabled,
    di.git_user_name,
    di.git_user_email,
    di.conflict_strategy,
    di.last_synced_at,
    di.created_at,
    di.updated_at
  FROM database_instances di`;

const databaseInstanceSelectLegacy = `
  SELECT
    di.id,
    di.uuid,
    di.name,
    di.repository_url,
    di.local_path,
    di.sync_strategy,
    di.auto_pull,
    di.enabled,
    di.personal_access_token,
    CASE
      WHEN di.personal_access_token IS NOT NULL AND TRIM(di.personal_access_token) != '' THEN 1
      ELSE 0
    END AS has_personal_access_token,
    di.is_private,
    di.local_ops_enabled,
    di.git_user_name,
    di.git_user_email,
    di.conflict_strategy,
    di.last_synced_at,
    di.created_at,
    di.updated_at
  FROM database_instances di`;

function supportsDatabaseInstanceCredentials(): boolean {
  const result = db.queryFirst<{ table_present: number }>(
    "SELECT 1 as table_present FROM sqlite_master WHERE type = 'table' AND name = 'database_instance_credentials' LIMIT 1"
  );
  return (result?.table_present ?? 0) === 1;
}

function toDbBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function getDatabaseInstanceSelect(): string {
  return supportsDatabaseInstanceCredentials() ? databaseInstanceSelectWithCredentials : databaseInstanceSelectLegacy;
}

/**
 * All queries for database_instances table
 */
export const databaseInstancesQueries = {
  /**
   * Create a new database instance
   */
  create(input: CreateDatabaseInstanceInput, credentialInput?: DatabaseInstanceCredentialWriteInput): number {
    const syncStrategy = input.syncStrategy ?? 0;
    const autoPull = toDbBoolean(input.autoPull !== false);
    const enabled = toDbBoolean(input.enabled !== false);
    const isPrivate = toDbBoolean(!!input.isPrivate);
    const localOpsEnabled = toDbBoolean(!!input.localOpsEnabled);
    const gitUserName = input.gitUserName || null;
    const gitUserEmail = input.gitUserEmail || null;
    const conflictStrategy = input.conflictStrategy ?? 'override';

    const useCredentialTable = supportsDatabaseInstanceCredentials();
    const persistedPersonalAccessToken = useCredentialTable ? '' : input.personalAccessToken || null;

    db.beginTransaction();
    try {
      db.execute(
        `INSERT INTO database_instances (
					uuid,
					name,
					repository_url,
					local_path,
					sync_strategy,
					auto_pull,
					enabled,
					personal_access_token,
					is_private,
					local_ops_enabled,
					git_user_name,
					git_user_email,
					conflict_strategy
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.uuid,
        input.name,
        input.repositoryUrl,
        input.localPath,
        syncStrategy,
        autoPull,
        enabled,
        persistedPersonalAccessToken,
        isPrivate,
        localOpsEnabled,
        gitUserName,
        gitUserEmail,
        conflictStrategy
      );

      // Get the last inserted ID
      const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
      const id = result?.id ?? 0;
      if (!id) {
        throw new Error('Failed to create database instance');
      }

      if (credentialInput !== undefined && useCredentialTable) {
        databaseInstanceCredentialsQueries.create({
          instanceId: id,
          ...credentialInput,
        });
      }

      db.commit();
      return id;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Get a database instance by ID
   */
  getById(id: number): DatabaseInstance | undefined {
    const databaseInstanceSelect = getDatabaseInstanceSelect();
    return db.queryFirst<DatabaseInstance>(`${databaseInstanceSelect} WHERE di.id = ?`, id);
  },

  /**
   * Get a database instance by UUID
   */
  getByUuid(uuid: string): DatabaseInstance | undefined {
    const databaseInstanceSelect = getDatabaseInstanceSelect();
    return db.queryFirst<DatabaseInstance>(`${databaseInstanceSelect} WHERE di.uuid = ?`, uuid);
  },

  /**
   * Get all database instances
   */
  getAll(): DatabaseInstance[] {
    const databaseInstanceSelect = getDatabaseInstanceSelect();
    return db.query<DatabaseInstance>(`${databaseInstanceSelect} ORDER BY di.name`);
  },

  /**
   * Get enabled database instances
   */
  getEnabled(): DatabaseInstance[] {
    const databaseInstanceSelect = getDatabaseInstanceSelect();
    return db.query<DatabaseInstance>(`${databaseInstanceSelect} WHERE di.enabled = 1 ORDER BY di.name`);
  },

  /**
   * Get databases that need auto-sync check
   * Note: last_synced_at may be ISO format (with T and Z), normalize for datetime()
   */
  getDueForSync(): DatabaseInstance[] {
    const databaseInstanceSelect = getDatabaseInstanceSelect();
    return db.query<DatabaseInstance>(
      `${databaseInstanceSelect}
       WHERE di.enabled = 1
       AND di.sync_strategy > 0
       AND (
         di.last_synced_at IS NULL
         OR datetime(replace(replace(di.last_synced_at, 'T', ' '), 'Z', ''), '+' || di.sync_strategy || ' minutes') <= datetime('now')
       )
       ORDER BY di.last_synced_at ASC NULLS FIRST`
    );
  },

  /**
   * Update a database instance
   */
  update(
    id: number,
    input: UpdateDatabaseInstanceInput,
    credentialInput?: DatabaseInstanceCredentialWriteInput
  ): boolean {
    const useCredentialTable = supportsDatabaseInstanceCredentials();
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
    if (input.personalAccessToken !== undefined) {
      updates.push('personal_access_token = ?');
      params.push(useCredentialTable ? '' : input.personalAccessToken || null);
    }
    if (input.localOpsEnabled !== undefined) {
      updates.push('local_ops_enabled = ?');
      params.push(toDbBoolean(input.localOpsEnabled));
    }
    if (input.gitUserName !== undefined) {
      updates.push('git_user_name = ?');
      params.push(input.gitUserName || null);
    }
    if (input.gitUserEmail !== undefined) {
      updates.push('git_user_email = ?');
      params.push(input.gitUserEmail || null);
    }
    if (input.conflictStrategy !== undefined) {
      updates.push('conflict_strategy = ?');
      params.push(input.conflictStrategy);
    }

    if (updates.length === 0 && credentialInput === undefined) {
      return false;
    }

    // Add updated_at
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.beginTransaction();
    try {
      let affected = db.execute(`UPDATE database_instances SET ${updates.join(', ')} WHERE id = ?`, ...params) > 0;

      if (credentialInput !== undefined && useCredentialTable) {
        databaseInstanceCredentialsQueries.upsert({
          instanceId: id,
          ...credentialInput,
        });
        affected = true;
      }

      db.commit();
      return affected;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Update last_synced_at timestamp
   */
  updateSyncedAt(id: number): boolean {
    const affected = db.execute(
      'UPDATE database_instances SET last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      id
    );
    return affected > 0;
  },

  /**
   * Delete a database instance
   */
  delete(id: number): boolean {
    const affected = db.execute('DELETE FROM database_instances WHERE id = ?', id);
    return affected > 0;
  },

  /**
   * Check if a database name already exists
   */
  nameExists(name: string, excludeId?: number): boolean {
    if (excludeId !== undefined) {
      const result = db.queryFirst<{ count: number }>(
        'SELECT COUNT(*) as count FROM database_instances WHERE name = ? AND id != ?',
        name,
        excludeId
      );
      return (result?.count ?? 0) > 0;
    }

    const result = db.queryFirst<{ count: number }>(
      'SELECT COUNT(*) as count FROM database_instances WHERE name = ?',
      name
    );
    return (result?.count ?? 0) > 0;
  },

  /**
   * Disable a database instance (set enabled = 0)
   */
  disable(id: number): boolean {
    const affected = db.execute(
      'UPDATE database_instances SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      id
    );
    return affected > 0;
  },
};

/**
 * Helper function to disable a database instance
 */
export function disableDatabaseInstance(id: number): boolean {
  return databaseInstancesQueries.disable(id);
}
