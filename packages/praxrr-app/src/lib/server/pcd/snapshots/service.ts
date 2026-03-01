/**
 * PCD Snapshot Service
 * Orchestration layer for snapshot creation, deduplication, and retention.
 */

import { db } from '$db/db.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import { logger } from '$logger/logger.ts';
import type {
  CreateAutoSnapshotInput,
  CreateManualSnapshotInput,
  PcdSnapshotDetail,
  PcdSnapshotFullDetail,
  PcdSnapshotListOptions,
  PcdSnapshotListResponse,
  SnapshotTrigger,
} from './types.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_AUTO_SNAPSHOTS = 50;
const MAX_AUTO_AGE_DAYS = 30;

/** Deduplication window in seconds */
const DEDUP_WINDOW_SECONDS = 60;

// ============================================================================
// HASH UTILITIES
// ============================================================================

/**
 * Compute SHA-256 hex digest of a string
 */
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// INTERNAL ROW TYPE FOR OPS QUERY
// ============================================================================

interface PublishedOpRow {
  id: number;
  origin: string;
  sequence: number | null;
  state: string;
  source: string;
  content_hash: string | null;
  sql: string;
  metadata: string | null;
}

// ============================================================================
// FINGERPRINT COMPUTATION
// ============================================================================

/**
 * Compute a deterministic state fingerprint from published ops for a database.
 *
 * Algorithm:
 * 1. Query all ops with `state = 'published'` for the database, ordered by id
 * 2. For each row, build a canonical record string including deterministic fields:
 *    database row id, origin, sequence, state, source, and hash
 * 3. When content_hash is absent, compute a fallback hash from sql + metadata
 * 4. Serialize as newline-delimited canonical records
 * 5. SHA-256 the full serialized string
 *
 * Returns null if no published ops exist.
 */
async function computeStateHash(databaseId: number): Promise<string | null> {
  const rows = db.query<PublishedOpRow>(
    `SELECT id, origin, sequence, state, source, content_hash, sql, metadata
		FROM pcd_ops
		WHERE database_id = ? AND state = 'published'
		ORDER BY id`,
    databaseId
  );

  if (rows.length === 0) {
    return null;
  }

  const recordLines: string[] = [];

  for (const row of rows) {
    let hash = row.content_hash;
    if (!hash) {
      hash = await sha256Hex(`${row.sql}\n${row.metadata ?? ''}`);
    }

    // Canonical record: deterministic fields separated by pipe
    const record = [String(row.id), row.origin, String(row.sequence ?? ''), row.state, row.source, hash].join('|');

    recordLines.push(record);
  }

  const serialized = recordLines.join('\n');
  return sha256Hex(serialized);
}

// ============================================================================
// OPS METADATA COMPUTATION
// ============================================================================

interface OpsMetadata {
  opsSequenceMaxId: number;
  opsCountBase: number;
  opsCountUser: number;
}

/**
 * Compute ops metadata for a database snapshot.
 * Returns the maximum pcd_ops row ID across all states and counts of published
 * ops by origin.
 */
function computeOpsMetadata(databaseId: number): OpsMetadata {
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
function computeOpsWrittenSince(databaseId: number, opsSequenceMaxId: number): number {
  const countResult = db.queryFirst<{ count: number }>(
    'SELECT COUNT(*) as count FROM pcd_ops WHERE database_id = ? AND id > ?',
    databaseId,
    opsSequenceMaxId
  );
  return countResult?.count ?? 0;
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

/**
 * Parse a SQLite datetime string (no timezone) as UTC and return epoch ms.
 * SQLite CURRENT_TIMESTAMP is stored in UTC; without a suffix JS may parse as local time.
 */
function parseCreatedAtUtc(createdAt: string): number {
  const s = createdAt.trim();
  if (!s) {
    throw new Error('Invalid pcd snapshot created_at value: missing timestamp');
  }

  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const createdAtMs = new Date(s).getTime();
    if (Number.isNaN(createdAtMs)) {
      throw new Error(`Invalid pcd snapshot created_at value: ${createdAt}`);
    }
    return createdAtMs;
  }

  const createdAtMs = new Date(s.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(createdAtMs)) {
    throw new Error(`Invalid pcd snapshot created_at value: ${createdAt}`);
  }

  return createdAtMs;
}

/**
 * Check whether an auto snapshot should be skipped as a duplicate.
 *
 * A snapshot is considered duplicate when the latest auto snapshot for the same
 * database + trigger matches both ops_sequence_max_id and cache_state_hash,
 * and was created within the deduplication window.
 */
function isDuplicate(
  databaseId: number,
  trigger: Exclude<SnapshotTrigger, 'manual'>,
  opsSequenceMaxId: number,
  cacheStateHash: string | null
): boolean {
  const latest = db.queryFirst<{
    id: number;
    ops_sequence_max_id: number;
    cache_state_hash: string | null;
    created_at: string;
  }>(
    `SELECT id, ops_sequence_max_id, cache_state_hash, created_at
		FROM pcd_snapshots
		WHERE database_id = ?
			AND "trigger" = ?
			AND type = 'auto'
		ORDER BY created_at DESC
		LIMIT 1`,
    databaseId,
    trigger
  );

  if (!latest) {
    return false;
  }

  if (latest.ops_sequence_max_id !== opsSequenceMaxId) {
    return false;
  }

  if (latest.cache_state_hash !== cacheStateHash) {
    return false;
  }

  // Check time window: interpret DB timestamp as UTC so elapsed time is environment-independent
  const createdAtMs = parseCreatedAtUtc(latest.created_at);
  const now = Date.now();
  const elapsedSeconds = (now - createdAtMs) / 1000;

  return elapsedSeconds <= DEDUP_WINDOW_SECONDS;
}

// ============================================================================
// AUTO SNAPSHOT
// ============================================================================

/**
 * Create an automatic (pre-risk) snapshot.
 *
 * Auto snapshots are best-effort: all errors are caught, logged, and result
 * in a null return. Deduplication and retention pruning are applied.
 */
async function createAutoSnapshot(input: CreateAutoSnapshotInput): Promise<PcdSnapshotDetail | null> {
  try {
    const { databaseId, trigger, targetInstanceIds } = input;

    const { opsSequenceMaxId, opsCountBase, opsCountUser } = computeOpsMetadata(databaseId);
    const cacheStateHash = await computeStateHash(databaseId);

    // Check deduplication
    if (isDuplicate(databaseId, trigger, opsSequenceMaxId, cacheStateHash)) {
      await logger.debug('Auto snapshot skipped (duplicate)', {
        source: 'SnapshotService',
        meta: { databaseId, trigger, opsSequenceMaxId },
      });
      return null;
    }

    const snapshot = pcdSnapshotQueries.create({
      databaseId,
      type: 'auto',
      trigger,
      opsSequenceMaxId,
      opsCountBase,
      opsCountUser,
      cacheStateHash,
      targetInstanceIds: targetInstanceIds ?? null,
    });

    await logger.debug('Auto snapshot created', {
      source: 'SnapshotService',
      meta: {
        snapshotId: snapshot.id,
        databaseId,
        trigger,
        opsSequenceMaxId,
      },
    });

    try {
      const pruned = pcdSnapshotQueries.pruneAutoSnapshots(databaseId, MAX_AUTO_SNAPSHOTS, MAX_AUTO_AGE_DAYS);
      if (pruned > 0) {
        await logger.debug('Auto snapshots pruned', {
          source: 'SnapshotService',
          meta: { databaseId, pruned },
        });
      }
    } catch (pruneError) {
      await logger.error('Failed to prune auto snapshots', {
        source: 'SnapshotService',
        meta: {
          databaseId,
          error: pruneError instanceof Error ? pruneError.message : String(pruneError),
          stack: pruneError instanceof Error ? pruneError.stack : undefined,
        },
      });
    }

    return snapshot;
  } catch (error) {
    await logger.error('Auto snapshot creation failed', {
      source: 'SnapshotService',
      meta: {
        databaseId: input.databaseId,
        trigger: input.trigger,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

// ============================================================================
// MANUAL SNAPSHOT
// ============================================================================

/**
 * Create a manual (user-initiated) snapshot.
 *
 * Manual snapshots are never deduplicated and not subject to auto-pruning.
 * Errors propagate to the caller since manual snapshots are user-initiated.
 */
async function createManualSnapshot(input: CreateManualSnapshotInput): Promise<PcdSnapshotDetail> {
  const { databaseId, description } = input;

  const { opsSequenceMaxId, opsCountBase, opsCountUser } = computeOpsMetadata(databaseId);
  const cacheStateHash = await computeStateHash(databaseId);
  const snapshot = pcdSnapshotQueries.create({
    databaseId,
    type: 'manual',
    trigger: 'manual',
    description,
    opsSequenceMaxId,
    opsCountBase,
    opsCountUser,
    cacheStateHash,
  });

  await logger.info('Manual snapshot created', {
    source: 'SnapshotService',
    meta: {
      snapshotId: snapshot.id,
      databaseId,
      opsSequenceMaxId,
    },
  });

  return snapshot;
}

// ============================================================================
// PASS-THROUGH METHODS
// ============================================================================

/**
 * List snapshots for a database with optional filtering and pagination
 */
function list(databaseId: number, options?: PcdSnapshotListOptions): PcdSnapshotListResponse {
  return pcdSnapshotQueries.listByDatabase(databaseId, options);
}

/**
 * Get snapshot detail by ID
 */
function getDetail(snapshotId: number): PcdSnapshotDetail | undefined {
  return pcdSnapshotQueries.getById(snapshotId);
}

/**
 * Get a snapshot with computed restore-context fields.
 */
function getFullDetail(snapshotId: number): PcdSnapshotFullDetail | undefined {
  const snapshot = getDetail(snapshotId);
  if (!snapshot) {
    return undefined;
  }

  const opsWrittenSince = computeOpsWrittenSince(snapshot.databaseId, snapshot.opsSequenceMaxId);

  return {
    ...snapshot,
    opsWrittenSince,
    isRestorable: false,
  };
}

/**
 * Delete a snapshot by ID
 */
function deleteSnapshot(snapshotId: number): boolean {
  return pcdSnapshotQueries.deleteById(snapshotId);
}

// ============================================================================
// EXPORT
// ============================================================================

export const snapshotService = {
  createAutoSnapshot,
  createManualSnapshot,
  list,
  getDetail,
  getFullDetail,
  deleteSnapshot,
};

export const __testOnly = {
  parseCreatedAtUtc,
};
