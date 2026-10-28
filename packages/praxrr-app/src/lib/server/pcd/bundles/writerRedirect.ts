/**
 * Writer scope seam for bundle import.
 *
 * Entity create/update handlers persist through `writeOperation` (re-exported by `$pcd/index.ts`).
 * While a writer scope is active with `apply` set, that re-export routes the write to `apply`
 * instead of persisting a `pcd_ops` row — the dry-run / preflight sandbox. Import types only, so
 * `$pcd/index.ts` can depend on it without an import cycle.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { WriteOptions, WriteResult } from '../core/types.ts';

export type WriterApply = (options: WriteOptions) => Promise<WriteResult>;

const storage = new AsyncLocalStorage<WriterApply>();

export function currentWriterApply(): WriterApply | undefined {
  return storage.getStore();
}

/** Run `fn` with `apply` receiving every `writeOperation` call; undefined `apply` keeps persistence. */
export function withWriterScope<T>(apply: WriterApply | undefined, fn: () => Promise<T>): Promise<T> {
  return apply ? storage.run(apply, fn) : fn();
}
