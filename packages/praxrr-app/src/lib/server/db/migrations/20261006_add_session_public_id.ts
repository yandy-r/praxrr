import type { Migration } from '../migrations.ts';

/**
 * Migration 20261006: Add independent `public_id` to sessions.
 *
 * `sessions.id` is the bearer cookie value and must never reach the browser. `public_id` is a
 * separate random UUID used as the only client-visible session handle (list + revoke).
 * Backfill uses a per-row SQL UUID-v4 expression; the unique index is created after backfill.
 * No `afterUp`: schema + backfill + index + version row commit in one runner transaction.
 */
// ponytail: nullable column + unique index, no NOT NULL/trigger; all writes go through sessionsQueries.create. Add a table rebuild with NOT NULL if another writer appears.
export const migration: Migration = {
  version: 20261006,
  name: 'Add public_id to sessions',

  up: `
		ALTER TABLE sessions ADD COLUMN public_id TEXT;
		UPDATE sessions SET public_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) WHERE public_id IS NULL;
		CREATE UNIQUE INDEX idx_sessions_public_id ON sessions(public_id);
	`,

  down: `
		DROP INDEX IF EXISTS idx_sessions_public_id;
		ALTER TABLE sessions DROP COLUMN public_id;
	`,
};
