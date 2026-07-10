/**
 * Lineage capture: the per-op observer + the `(table, rowKey, column)` writer index.
 *
 * The observer is passed to `PCDCache.buildReadOnly` as `onOp`. For each op it:
 *   1. analyzes the op SQL into per-statement write sets (`analyzeOpWriteSets`),
 *   2. resolves which rows the op touches from LIVE row snapshots (never by parsing values):
 *      INSERT -> rowid snapshot diff; UPDATE/DELETE -> `SELECT <keys> ... WHERE <whereExpr>`,
 *   3. pushes a `CellLineage` (the op's identity + layer) onto each touched
 *      `(table, rowKey, column)` cell's stack (last replay op ends up on top).
 * DELETE evicts the row's cells. The index keeps a STACK per cell so the engine can
 * re-resolve to a prior surviving writer when the top writer's op was skipped/errored
 * by the live value-guard build (AC4).
 *
 * The observer never throws into the replay loop: any capture failure is swallowed so a
 * lineage bug can never corrupt the ephemeral cache build.
 */

import type { Database } from '@jsr/db__sqlite';
import type { Operation } from '../../core/types.ts';
import type { LineageOpRef, LineageSourceLayer } from '$shared/pcd/fieldLineage.ts';
import { analyzeOpWriteSets, type WriteSet } from './opWriteSet.ts';
import { buildRowKey, KEY_DELIMITER, LINEAGE_TABLE_KEYS, type RowKey } from './tableKeys.ts';

/** One explicit writer of a cell (a stack element in the index). */
export interface CellLineage {
  readonly sourceLayer: LineageSourceLayer;
  readonly opId: number | null;
  readonly opRef: LineageOpRef | null;
  /** `'ambiguous'` when the establishing op's SQL could not be fully parsed. */
  readonly parseStatus: 'parsed' | 'ambiguous';
}

export interface LineageIndex {
  /** Push a writer onto the `(table, rowKey, column)` cell's stack. */
  push(table: string, rowKey: RowKey, column: string, cell: CellLineage): void;
  /** The full writer stack (replay order) for a cell, or undefined if never written. */
  getStack(table: string, rowKey: RowKey, column: string): readonly CellLineage[] | undefined;
  /** Remove every cell belonging to a row (on DELETE). */
  evictRow(table: string, rowKey: RowKey): void;
}

function cellKey(table: string, rowKey: RowKey, column: string): string {
  return `${table}${KEY_DELIMITER}${rowKey}${KEY_DELIMITER}${column}`;
}

export function createLineageIndex(): LineageIndex {
  const stacks = new Map<string, CellLineage[]>();
  const rowColumns = new Map<string, Set<string>>(); // `${table}\x00${rowKey}` -> columns written

  function rowTag(table: string, rowKey: RowKey): string {
    return `${table}${KEY_DELIMITER}${rowKey}`;
  }

  return {
    push(table, rowKey, column, cell) {
      const key = cellKey(table, rowKey, column);
      const stack = stacks.get(key);
      if (stack) stack.push(cell);
      else stacks.set(key, [cell]);
      const tag = rowTag(table, rowKey);
      const cols = rowColumns.get(tag);
      if (cols) cols.add(column);
      else rowColumns.set(tag, new Set([column]));
    },
    getStack(table, rowKey, column) {
      return stacks.get(cellKey(table, rowKey, column));
    },
    evictRow(table, rowKey) {
      const tag = rowTag(table, rowKey);
      const cols = rowColumns.get(tag);
      if (!cols) return;
      for (const column of cols) stacks.delete(cellKey(table, rowKey, column));
      rowColumns.delete(tag);
    }
  };
}

interface PendingCapture {
  readonly ws: WriteSet;
  /** INSERT: rowids present before exec. */
  readonly beforeRowids?: Set<number>;
  /** UPDATE/DELETE: rowKeys of matched rows, resolved before exec. */
  readonly rowKeys?: RowKey[];
}

interface OpIdentity {
  readonly sourceLayer: LineageSourceLayer;
  readonly opId: number | null;
  readonly opRef: LineageOpRef | null;
  readonly parseStatus: 'parsed' | 'ambiguous';
}

function parseOpId(filepath: string): number | null {
  if (!filepath.startsWith('pcd_ops:')) return null;
  const raw = Number(filepath.slice('pcd_ops:'.length));
  return Number.isFinite(raw) ? raw : null;
}

function opIdentity(op: Operation, parseStatus: 'parsed' | 'ambiguous'): OpIdentity {
  const opId = parseOpId(op.filepath);
  return {
    sourceLayer: op.layer as LineageSourceLayer,
    opId,
    opRef: opId === null ? { filename: op.filename, order: op.order } : null,
    parseStatus
  };
}

/** All current rowids of a table. */
function snapshotRowids(db: Database, table: string): Set<number> {
  const rows = db.prepare(`SELECT rowid AS rid FROM "${table}"`).all() as Array<{ rid: number }>;
  return new Set(rows.map((r) => Number(r.rid)));
}

/** Read the business-key `RowKey`s of rows matching `whereExpr` (or all rows when null). */
function matchedRowKeys(db: Database, table: string, whereExpr: string | null): RowKey[] {
  const keyColumns = LINEAGE_TABLE_KEYS[table];
  if (!keyColumns) return [];
  const cols = keyColumns.map((c) => `"${c}"`).join(', ');
  const sql = whereExpr ? `SELECT ${cols} FROM "${table}" WHERE ${whereExpr}` : `SELECT ${cols} FROM "${table}"`;
  const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
  const keys: RowKey[] = [];
  for (const row of rows) {
    const key = buildRowKey(table, row);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/** Read the `RowKey` for a single rowid (INSERTed row). */
function rowKeyForRowid(db: Database, table: string, rowid: number): RowKey | null {
  const keyColumns = LINEAGE_TABLE_KEYS[table];
  if (!keyColumns) return null;
  const cols = keyColumns.map((c) => `"${c}"`).join(', ');
  const row = db.prepare(`SELECT ${cols} FROM "${table}" WHERE rowid = ?`).get(rowid) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return buildRowKey(table, row);
}

/**
 * Create the `onOp` observer that captures writes into `index`. Every hook body is wrapped so
 * it can never throw into the replay loop.
 */
export function createLineageObserver(index: LineageIndex): {
  before(op: Operation, db: Database): void;
  after(op: Operation, db: Database): void;
} {
  let pending: PendingCapture[] = [];
  let identity: OpIdentity | null = null;

  return {
    before(op, db) {
      pending = [];
      identity = null;
      try {
        const result = analyzeOpWriteSets(op.sql);
        identity = opIdentity(op, result.parseStatus);
        for (const ws of result.writeSets) {
          if (!(ws.table in LINEAGE_TABLE_KEYS)) continue;
          if (ws.kind === 'insert') {
            pending.push({ ws, beforeRowids: snapshotRowids(db, ws.table) });
          } else {
            pending.push({ ws, rowKeys: matchedRowKeys(db, ws.table, ws.whereExpr) });
          }
        }
      } catch {
        // Capture is best-effort; a failure here must not break the replay.
        pending = [];
        identity = null;
      }
    },
    after(op, db) {
      const id = identity;
      if (!id) {
        pending = [];
        return;
      }
      try {
        for (const p of pending) {
          const { ws } = p;
          if (ws.kind === 'delete') {
            for (const rowKey of p.rowKeys ?? []) index.evictRow(ws.table, rowKey);
            continue;
          }
          if (ws.kind === 'insert') {
            const after = snapshotRowids(db, ws.table);
            for (const rowid of after) {
              if (p.beforeRowids?.has(rowid)) continue;
              const rowKey = rowKeyForRowid(db, ws.table, rowid);
              if (rowKey === null) continue;
              for (const column of ws.columns) {
                index.push(ws.table, rowKey, column, {
                  sourceLayer: id.sourceLayer,
                  opId: id.opId,
                  opRef: id.opRef,
                  parseStatus: id.parseStatus
                });
              }
            }
            continue;
          }
          // update
          for (const rowKey of p.rowKeys ?? []) {
            for (const column of ws.columns) {
              index.push(ws.table, rowKey, column, {
                sourceLayer: id.sourceLayer,
                opId: id.opId,
                opRef: id.opRef,
                parseStatus: id.parseStatus
              });
            }
          }
        }
      } catch {
        // Swallow: partial capture is acceptable; never corrupt the build.
      } finally {
        pending = [];
        identity = null;
      }
    }
  };
}
