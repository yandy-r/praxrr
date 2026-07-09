import type { Migration } from '../migrations.ts';

/**
 * Migration 20260716: Create timeline_annotations table (issue #27).
 *
 * The Sync Archaeology Timeline is a pure read/visual layer over four existing event
 * sources (sync_history, canary_rollouts, pcd_snapshots, pcd_rollbacks); it introduces no
 * materialized event store. This table is the ONLY new persistent timeline state: free-text
 * user notes ("rolled back because X") attached to a timeline event.
 *
 * Because events come from four tables with independent id spaces, an annotation carries a
 * SOFT (event_source, event_id) reference — there is no cross-table FK. The CHECK is scoped
 * to the four ACTIVE sources; when a future source (pcd-op, drift) starts producing events the
 * CHECK is widened via a small follow-up migration (the 20260712 snapshot-trigger-CHECK
 * precedent), and the write path validates event_source against the active producer set.
 *
 * Orphans are PRESERVED by design: when a source row is retention-pruned the note is often the
 * only surviving record of "why", which is the whole point of an archaeology timeline. The read
 * path only hydrates annotations for events currently in the feed, so orphans are invisible by
 * construction; a pruneOrphans() helper exists but is never wired into any cleanup job.
 *
 * author_user_id is a nullable FK ON DELETE SET NULL and author_name is denormalized so a note
 * survives user deletion (and AUTH=off, where no user id exists). Timestamp convention matches
 * the sync-history bookkeeping columns: created_at/updated_at are CURRENT_TIMESTAMP TEXT.
 */
export const migration: Migration = {
  version: 20260716,
  name: 'Create timeline annotations table',

  up: `
		CREATE TABLE timeline_annotations (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			event_source   TEXT NOT NULL CHECK (event_source IN ('sync', 'snapshot', 'rollback', 'canary')),
			event_id       INTEGER NOT NULL,
			body           TEXT NOT NULL CHECK (LENGTH(TRIM(body)) > 0 AND LENGTH(body) <= 4000),
			author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			author_name    TEXT,
			created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX idx_timeline_annotations_event
			ON timeline_annotations(event_source, event_id);
	`,

  down: `
		DROP INDEX IF EXISTS idx_timeline_annotations_event;
		DROP TABLE IF EXISTS timeline_annotations;
	`,
};
