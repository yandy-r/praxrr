import { AsyncLocalStorage } from 'node:async_hooks';

/** Ids of `pcd_ops` / `pcd_op_history` rows inserted inside a recorder scope. */
export interface CreatedOpRecord {
  opIds: number[];
  historyIds: number[];
}

const storage = new AsyncLocalStorage<CreatedOpRecord>();

/**
 * Record every op/history row inserted by `fn`'s async context (YAN-466), so a failed
 * import can delete exactly its own rows. Inserts from unrelated async contexts are
 * never recorded.
 */
export function withOpCreationRecorder<T>(record: CreatedOpRecord, fn: () => Promise<T>): Promise<T> {
  return storage.run(record, fn);
}

export function recordCreatedOpId(id: number): void {
  if (id > 0) storage.getStore()?.opIds.push(id);
}

export function recordCreatedHistoryId(id: number): void {
  if (id > 0) storage.getStore()?.historyIds.push(id);
}
