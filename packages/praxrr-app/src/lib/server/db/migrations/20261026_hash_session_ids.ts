import type { Migration } from '../migrations.ts';
import { db } from '../db.ts';
import { logger } from '$logger/logger.ts';

/**
 * Migration 20261026: Stop storing session bearers in `sessions.id` (YAN-1264).
 *
 * Historically `sessions.id` was the raw `session` cookie value, so a leaked DB file was a leaked
 * bearer credential. From now on `sessions.id` stores the SHA-256 hex of the cookie value (see
 * `hashSessionToken` in `$db/queries/sessions.ts`); the cookie keeps the raw random token.
 *
 * Legacy rows are INVALIDATED, not rehashed: a rehashed row would still be a valid credential
 * in pre-upgrade backups, the WAL, and SQLite free pages. Existing users therefore log in once
 * after upgrading (release note: "all sessions are signed out on upgrade").
 *
 * `up` is a no-op statement because the schema is unchanged — the runner commits `up` before
 * `afterUp`, and a failed `afterUp` must not leave a half-applied schema that breaks the next
 * boot. `afterUp` runs between runner transactions, so the PRAGMAs below execute outside a
 * transaction (required: `secure_delete` and `wal_checkpoint` are no-ops inside one).
 *
 * `down` has nothing to restore (plaintext ids are gone), so it deletes all sessions. Before
 * downgrading below this version, run `DELETE FROM sessions`: the stored hashes would otherwise
 * act as cookie values on older versions that look sessions up by raw cookie.
 */
export const migration: Migration = {
  version: 20261026,
  name: 'Invalidate plaintext session ids',

  up: `SELECT 1;`,

  down: `
		DELETE FROM sessions;
	`,

  afterUp: () => invalidateLegacySessions(),
};

/** 64 lowercase hex characters — the shape of every stored `sessions.id` after this migration. */
const HASHED_SESSION_ID = /^[0-9a-f]{64}$/;

/**
 * Delete every session whose id is not already hash-shaped, zeroing the freed pages and
 * truncating the WAL so the plaintext bearers do not linger on disk. Idempotent: hashed rows
 * (e.g. created after a crash between `afterUp` and the version row) survive a rerun.
 */
export async function invalidateLegacySessions(): Promise<void> {
  const previous = db.queryFirst<{ secure_delete: number }>('PRAGMA secure_delete');
  db.exec('PRAGMA secure_delete = ON');
  try {
    const legacyIds = db
      .query<{ id: string }>('SELECT id FROM sessions')
      .filter(({ id }) => !HASHED_SESSION_ID.test(id));
    await db.transaction(() => {
      for (const { id } of legacyIds) {
        db.execute('DELETE FROM sessions WHERE id = ?', id);
      }
    });
  } finally {
    // The pragma reports FAST as 2 but only accepts the FAST keyword (a numeric 2 reads as boolean).
    const prior = previous?.secure_delete ?? 0;
    db.exec(`PRAGMA secure_delete = ${prior === 2 ? 'FAST' : prior}`);
  }
  const checkpoint = db.queryFirst<{ busy: number }>('PRAGMA wal_checkpoint(TRUNCATE)');
  if (checkpoint && checkpoint.busy !== 0) {
    await logger.warn('WAL checkpoint was blocked; legacy session ids may linger in the WAL file', {
      source: 'DatabaseMigrations',
      meta: { version: 20261026 },
    });
  }
}
