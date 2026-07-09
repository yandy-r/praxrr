import type { Migration } from '../migrations.ts';

/**
 * Migration 20260710: Create sync history / audit trail tables (issue #17).
 *
 * - `sync_history`: append-only, one row per instance sync run. Unlike drift's
 *   latest-state upsert table, this GROWS over time and is retention-pruned. The
 *   FK is nullable `ON DELETE SET NULL` and `instance_name`/`arr_type` are
 *   denormalized so audit rows survive instance deletion (the
 *   `startup_pull_instance_outcomes` pattern). Entity detail lives in the
 *   `changes` / `section_results` JSON blobs.
 * - `sync_history_settings`: singleton (id=1) driving retention (age + max
 *   entries) and a global enable flag for recording + the daily
 *   `sync.history.cleanup` job.
 *
 * Timestamp convention (matches 20260709_create_drift_tables): `started_at` /
 * `finished_at` are ISO-8601 UTC TEXT written from JS; `created_at` is bookkeeping
 * `CURRENT_TIMESTAMP`. Date-range filters and retention DELETEs MUST wrap the ISO
 * column in `datetime(...)` — never a raw string compare.
 */
export const migration: Migration = {
  version: 20260710,
  name: 'Create sync history tables',

  up: `
		CREATE TABLE sync_history (
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			arr_instance_id     INTEGER REFERENCES arr_instances(id) ON DELETE SET NULL,
			instance_name       TEXT NOT NULL,
			arr_type            TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
			job_id              INTEGER,
			trigger             TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule', 'system')),
			trigger_event       TEXT CHECK (trigger_event IN ('on_pull', 'on_change') OR trigger_event IS NULL),
			sections_attempted  TEXT NOT NULL DEFAULT '[]',
			status              TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
			sections_run        INTEGER NOT NULL DEFAULT 0,
			items_synced        INTEGER NOT NULL DEFAULT 0,
			failure_count       INTEGER NOT NULL DEFAULT 0,
			entity_change_count INTEGER NOT NULL DEFAULT 0,
			section_results     TEXT NOT NULL DEFAULT '[]',
			changes             TEXT NOT NULL DEFAULT '[]',
			error               TEXT,
			started_at          TEXT NOT NULL,
			finished_at         TEXT,
			duration_ms         INTEGER,
			created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX idx_sync_history_started_at ON sync_history(started_at DESC);
		CREATE INDEX idx_sync_history_instance ON sync_history(arr_instance_id);
		CREATE INDEX idx_sync_history_status ON sync_history(status);
		CREATE INDEX idx_sync_history_trigger ON sync_history(trigger);
		CREATE INDEX idx_sync_history_arr_type ON sync_history(arr_type);

		CREATE TABLE sync_history_settings (
			id                    INTEGER PRIMARY KEY CHECK (id = 1),
			enabled               INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			retention_days        INTEGER NOT NULL DEFAULT 90 CHECK (retention_days >= 1),
			retention_max_entries INTEGER NOT NULL DEFAULT 10000 CHECK (retention_max_entries >= 0),
			created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		INSERT INTO sync_history_settings (id) VALUES (1);
	`,

  down: `
		DROP INDEX IF EXISTS idx_sync_history_arr_type;
		DROP INDEX IF EXISTS idx_sync_history_trigger;
		DROP INDEX IF EXISTS idx_sync_history_status;
		DROP INDEX IF EXISTS idx_sync_history_instance;
		DROP INDEX IF EXISTS idx_sync_history_started_at;
		DROP TABLE IF EXISTS sync_history;
		DROP TABLE IF EXISTS sync_history_settings;
	`,
};
