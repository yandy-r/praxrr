import { AsyncLocalStorage } from 'node:async_hooks';

/** Ids of `pcd_ops` / `pcd_op_history` rows inserted or updated inside a recorder scope. */
export interface CreatedOpRecord {
  opIds: number[];
  historyIds: number[];
  /** Pre-existing `pcd_ops` rows updated inside the scope (the only rows a rollback restores). */
  updatedOpIds: number[];
}

/** A scope's record plus its enclosing scope, so nested writes reach every enclosing record. */
interface RecorderScope {
  record: CreatedOpRecord;
  parent: RecorderScope | undefined;
}

const storage = new AsyncLocalStorage<RecorderScope>();

/**
 * Record every op/history row inserted or updated by `fn`'s async context (YAN-466), so a
 * failed import or override can undo exactly its own writes. Writes from unrelated async
 * contexts are never recorded.
 *
 * Scopes nest: a child scope records into its own `record` AND propagates every id to each
 * enclosing scope's record, so an outer rollback (e.g. a failed import whose final compile runs
 * an auto-override) still sees writes made inside an inner scope, even one that rolled itself back.
 */
export function withOpCreationRecorder<T>(record: CreatedOpRecord, fn: () => T): T {
  return storage.run({ record, parent: storage.getStore() }, fn);
}

function eachRecord(visit: (record: CreatedOpRecord) => void): void {
  for (let scope = storage.getStore(); scope; scope = scope.parent) {
    visit(scope.record);
  }
}

export function recordCreatedOpId(id: number): void {
  if (id > 0) eachRecord((record) => record.opIds.push(id));
}

export function recordCreatedHistoryId(id: number): void {
  if (id > 0) eachRecord((record) => record.historyIds.push(id));
}

export function recordUpdatedOpIds(ids: ReadonlyArray<number>): void {
  eachRecord((record) => record.updatedOpIds.push(...ids));
}
