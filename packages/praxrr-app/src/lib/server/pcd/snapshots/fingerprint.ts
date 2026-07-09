/**
 * PCD Snapshot State Fingerprint
 *
 * Single source of truth for the deterministic published-op fingerprint that a snapshot
 * captures (`cache_state_hash`) and that rollback reconstruction verifies against. Snapshot
 * capture (`service.ts`) and rollback reconstruction (`reconstruct.ts`) MUST hash through
 * this module so the two can never drift byte-for-byte.
 *
 * Soundness invariants the fingerprint depends on (documented, and guarded by tests):
 * 1. `content_hash` stays consistent with `sql` + `metadata` for every published op — the
 *    fingerprint anchors to `content_hash` and excludes `sql`/`filename`. Today the only
 *    write path that mutates `sql` (the repo-import UPDATE in `ops/writer.ts`) recomputes
 *    `content_hash` in the same call, so `content_hash === buildContentHash(sql, metadata)`
 *    holds for all writer ops. A future `sql`-only mutation would break this.
 * 2. No two same-layer published ops share a `sequence` — compilation breaks ties by
 *    `filename` (not in the fingerprint). Both hold in the current codebase.
 */

import { db } from '$db/db.ts';

/**
 * The columns the fingerprint canonicalizes over. Matches the `SELECT` in `computeStateHash`
 * and the reconstruction query in `reconstruct.ts`.
 */
export interface FingerprintOpRow {
  id: number;
  origin: string;
  sequence: number | null;
  state: string;
  source: string;
  content_hash: string | null;
  sql: string;
  metadata: string | null;
}

export interface OpsMetadata {
  opsSequenceMaxId: number;
  opsCountBase: number;
  opsCountUser: number;
}

/**
 * Compute SHA-256 hex digest of a string.
 */
export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build the canonical per-row record string.
 *
 * `forceStatePublished` forces the `state` field to the literal `'published'` regardless of
 * the row's current state. Capture reads only `state='published'` rows, so both modes emit
 * `'published'` for a faithful set; reconstruction sets it true because a member of the
 * snapshot set was published at capture time even if its live state has since transitioned.
 *
 * `content_hash` fallback replicates capture exactly: real published ops (e.g. Lidarr seed
 * migrations) have a NULL `content_hash`, so the fallback `sha256(sql + '\n' + (metadata ??
 * ''))` MUST be byte-for-byte identical or verification would fail-closed for those DBs.
 */
export async function canonicalRecordForRow(row: FingerprintOpRow, forceStatePublished: boolean): Promise<string> {
  let hash = row.content_hash;
  if (!hash) {
    hash = await sha256Hex(`${row.sql}\n${row.metadata ?? ''}`);
  }

  const state = forceStatePublished ? 'published' : row.state;
  return [String(row.id), row.origin, String(row.sequence ?? ''), state, row.source, hash].join('|');
}

/**
 * Compute the deterministic fingerprint over an ordered set of op rows.
 *
 * Rows MUST already be ordered by `id` ascending (a single interleaved base+user stream, no
 * origin split) to match capture. Returns `null` for an empty set (no published state).
 */
export async function computeStateFingerprint(
  rows: readonly FingerprintOpRow[],
  opts: { forceStatePublished?: boolean } = {}
): Promise<string | null> {
  if (rows.length === 0) {
    return null;
  }

  const forceStatePublished = opts.forceStatePublished ?? false;
  const recordLines: string[] = [];
  for (const row of rows) {
    recordLines.push(await canonicalRecordForRow(row, forceStatePublished));
  }

  return sha256Hex(recordLines.join('\n'));
}

/**
 * Compute the current published-op fingerprint for a database. Returns `null` when the
 * database has no published ops.
 */
export function computeStateHash(databaseId: number): Promise<string | null> {
  const rows = db.query<FingerprintOpRow>(
    `SELECT id, origin, sequence, state, source, content_hash, sql, metadata
		FROM pcd_ops
		WHERE database_id = ? AND state = 'published'
		ORDER BY id`,
    databaseId
  );

  return computeStateFingerprint(rows, {});
}

/**
 * The exact set of currently-published `pcd_ops.id`s for a database, ordered by id — the
 * manifest a snapshot captures so rollback can replay it verbatim (issue #16). Uses the same
 * `state='published' ORDER BY id` selection as `computeStateHash`, so the manifest and the
 * fingerprint captured together are always consistent.
 */
export function computePublishedOpIds(databaseId: number): number[] {
  const rows = db.query<{ id: number }>(
    "SELECT id FROM pcd_ops WHERE database_id = ? AND state = 'published' ORDER BY id",
    databaseId
  );
  return rows.map((row) => row.id);
}

/**
 * Compute ops metadata for a database snapshot: the maximum `pcd_ops` row id across all
 * states, and published-op counts by origin.
 */
export function computeOpsMetadata(databaseId: number): OpsMetadata {
  const maxIdResult = db.queryFirst<{ max_id: number | null }>(
    `SELECT MAX(id) as max_id FROM pcd_ops WHERE database_id = ?`,
    databaseId
  );
  const opsSequenceMaxId = maxIdResult?.max_id ?? 0;

  const baseCountResult = db.queryFirst<{ count: number }>(
    `SELECT COUNT(*) as count FROM pcd_ops
		WHERE database_id = ? AND state = 'published' AND origin = 'base'`,
    databaseId
  );
  const opsCountBase = baseCountResult?.count ?? 0;

  const userCountResult = db.queryFirst<{ count: number }>(
    `SELECT COUNT(*) as count FROM pcd_ops
		WHERE database_id = ? AND state = 'published' AND origin = 'user'`,
    databaseId
  );
  const opsCountUser = userCountResult?.count ?? 0;

  return { opsSequenceMaxId, opsCountBase, opsCountUser };
}

/**
 * Count all ops written after a snapshot sequence marker.
 */
export function computeOpsWrittenSince(databaseId: number, opsSequenceMaxId: number): number {
  const countResult = db.queryFirst<{ count: number }>(
    'SELECT COUNT(*) as count FROM pcd_ops WHERE database_id = ? AND id > ?',
    databaseId,
    opsSequenceMaxId
  );
  return countResult?.count ?? 0;
}
