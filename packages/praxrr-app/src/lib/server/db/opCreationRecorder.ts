import { AsyncLocalStorage } from 'node:async_hooks';

/** Ids of `pcd_ops` / `pcd_op_history` rows inserted or updated inside a recorder scope. */
export interface CreatedOpRecord {
  opIds: number[];
  historyIds: number[];
  /** Pre-existing `pcd_ops` rows updated inside the scope (the only rows a rollback restores). */
  updatedOpIds: number[];
}

const storage = new AsyncLocalStorage<CreatedOpRecord>();

/**
 * Record every op/history row inserted or updated by `fn`'s async context (YAN-466), so a
 * failed import can undo exactly its own writes. Writes from unrelated async contexts are
 * never recorded. Not reentrant: a nested scope would hide writes from the outer record.
 */
export function withOpCreationRecorder<T>(record: CreatedOpRecord, fn: () => T): T {
  if (storage.getStore()) throw new Error('withOpCreationRecorder cannot be nested');
  return storage.run(record, fn);
}

export function recordCreatedOpId(id: number): void {
  if (id > 0) storage.getStore()?.opIds.push(id);
}

export function recordCreatedHistoryId(id: number): void {
  if (id > 0) storage.getStore()?.historyIds.push(id);
}

export function recordUpdatedOpIds(ids: ReadonlyArray<number>): void {
  storage.getStore()?.updatedOpIds.push(...ids);
}
