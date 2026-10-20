import { db } from '../db.ts';

/**
 * Queries for arr_trash_guide_namespaces.
 *
 * Each (Arr instance, TRaSH source) pair is assigned a 1-based index once; it feeds
 * `getTrashGuideNamespaceSuffix` and is never reassigned while the row exists.
 */
export const arrTrashNamespaceQueries = {
  /** Namespace index for a (instance, source) pair, or null if none was ever assigned. */
  get(instanceId: number, sourceId: number): number | null {
    const row = db.queryFirst<{ namespace_index: number }>(
      'SELECT namespace_index FROM arr_trash_guide_namespaces WHERE instance_id = ? AND source_id = ?',
      instanceId,
      sourceId
    );
    return row?.namespace_index ?? null;
  },

  /**
   * Namespace index for a (instance, source) pair, assigning `MAX + 1` for the instance if absent.
   * Allocation is one INSERT … SELECT statement (atomic). `OR IGNORE` keeps an existing row for this
   * source; if another writer took the computed index for a different source, the next attempt
   * recomputes MAX.
   */
  getOrCreate(instanceId: number, sourceId: number): number {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = arrTrashNamespaceQueries.get(instanceId, sourceId);
      if (existing !== null) return existing;

      db.execute(
        `INSERT OR IGNORE INTO arr_trash_guide_namespaces (instance_id, source_id, namespace_index)
				 SELECT ?, ?, COALESCE(MAX(namespace_index), 0) + 1
				   FROM arr_trash_guide_namespaces
				  WHERE instance_id = ?`,
        instanceId,
        sourceId,
        instanceId
      );
    }

    const assigned = arrTrashNamespaceQueries.get(instanceId, sourceId);
    if (assigned === null) {
      throw new Error(`Failed to assign TRaSH namespace index for instance ${instanceId}, source ${sourceId}`);
    }
    return assigned;
  },

  /** Highest assigned index for an Arr instance; 0 when the instance has no rows yet. */
  getMaxIndex(instanceId: number): number {
    const row = db.queryFirst<{ max_index: number | null }>(
      'SELECT MAX(namespace_index) AS max_index FROM arr_trash_guide_namespaces WHERE instance_id = ?',
      instanceId
    );
    return row?.max_index ?? 0;
  },
};
