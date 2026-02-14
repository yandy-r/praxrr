import { db } from '../db.ts';

export interface ArrDatabaseNamespace {
  instance_id: number;
  database_id: number;
  namespace_index: number;
}

/**
 * Queries for arr_database_namespaces table.
 *
 * Each (Arr instance, database) pair is assigned a small integer index
 * used to generate a zero-width Unicode suffix during sync.
 */
export const arrNamespaceQueries = {
  /**
   * Get the namespace index for a (instance, database) pair,
   * creating one if it doesn't exist.
   */
  getOrCreate(instanceId: number, databaseId: number): number {
    const existing = db.queryFirst<{ namespace_index: number }>(
      'SELECT namespace_index FROM arr_database_namespaces WHERE instance_id = ? AND database_id = ?',
      instanceId,
      databaseId
    );

    if (existing) return existing.namespace_index;

    // Assign next available index for this instance (1-based)
    const max = db.queryFirst<{ max_index: number | null }>(
      'SELECT MAX(namespace_index) as max_index FROM arr_database_namespaces WHERE instance_id = ?',
      instanceId
    );
    const nextIndex = (max?.max_index ?? 0) + 1;

    db.execute(
      'INSERT INTO arr_database_namespaces (instance_id, database_id, namespace_index) VALUES (?, ?, ?)',
      instanceId,
      databaseId,
      nextIndex
    );

    return nextIndex;
  },

  /**
   * Get the namespace index for a (instance, database) pair.
   * Returns null if no namespace has been assigned.
   */
  get(instanceId: number, databaseId: number): number | null {
    const result = db.queryFirst<{ namespace_index: number }>(
      'SELECT namespace_index FROM arr_database_namespaces WHERE instance_id = ? AND database_id = ?',
      instanceId,
      databaseId
    );
    return result?.namespace_index ?? null;
  },

  /**
   * Get all namespace mappings for an Arr instance.
   */
  getForInstance(instanceId: number): ArrDatabaseNamespace[] {
    return db.query<ArrDatabaseNamespace>(
      'SELECT * FROM arr_database_namespaces WHERE instance_id = ? ORDER BY namespace_index',
      instanceId
    );
  },

  /**
   * Delete the namespace mapping for a (instance, database) pair.
   */
  delete(instanceId: number, databaseId: number): boolean {
    const affected = db.execute(
      'DELETE FROM arr_database_namespaces WHERE instance_id = ? AND database_id = ?',
      instanceId,
      databaseId
    );
    return affected > 0;
  },
};
