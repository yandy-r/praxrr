import type { Migration } from '../migrations.ts';

/**
 * Migration 20260709: Create drift detection tables.
 *
 * - `drift_check_settings`: singleton (id=1) driving the global recurring drift.check job
 *   (enable/disable, interval, handler-owned backoff state).
 * - `drift_instance_status`: latest-state, one upserted row per Arr instance. Entity detail
 *   lives in the `changes` JSON blob; `unchanged` entities are never persisted, so the table
 *   is bounded by the number of instances and cannot grow with time. PK == FK with
 *   ON DELETE CASCADE reaps the row when its instance is deleted.
 *
 * Timestamps that drive scheduling/dedup (last_run_at, backoff_until, checked_at,
 * content_checked_at) are TEXT ISO-8601 UTC to match jobQueue due-detection; bookkeeping
 * columns use DATETIME DEFAULT CURRENT_TIMESTAMP.
 */
export const migration: Migration = {
  version: 20260709,
  name: 'Create drift detection tables',

  up: `
		CREATE TABLE drift_check_settings (
			id               INTEGER PRIMARY KEY CHECK (id = 1),
			enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (interval_minutes >= 5),
			last_run_at      TEXT,
			error_count      INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
			backoff_until    TEXT,
			created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		INSERT INTO drift_check_settings (id) VALUES (1);

		CREATE TABLE drift_instance_status (
			arr_instance_id    INTEGER PRIMARY KEY REFERENCES arr_instances(id) ON DELETE CASCADE,
			arr_type           TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
			status             TEXT NOT NULL CHECK (status IN ('in-sync', 'drifted', 'unreachable', 'unauthorized', 'error')),
			reason             TEXT CHECK (
				reason IN ('unreachable', 'timeout', 'unauthorized', 'invalid_response', 'not_configured', 'cache_not_ready', 'rate_limited', 'error')
				OR reason IS NULL
			),
			drifted_count      INTEGER NOT NULL DEFAULT 0,
			missing_count      INTEGER NOT NULL DEFAULT 0,
			unmanaged_count    INTEGER NOT NULL DEFAULT 0,
			drift_signature    TEXT,
			notified_signature TEXT,
			detected_version   TEXT,
			changes            TEXT NOT NULL DEFAULT '[]',
			checked_at         TEXT NOT NULL,
			content_checked_at TEXT,
			duration_ms        INTEGER,
			created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`,

  down: `
		DROP TABLE IF EXISTS drift_instance_status;
		DROP TABLE IF EXISTS drift_check_settings;
	`,
};
