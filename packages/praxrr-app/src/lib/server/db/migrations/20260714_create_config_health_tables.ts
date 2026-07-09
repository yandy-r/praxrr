import type { Migration } from '../migrations.ts';

/**
 * Migration 20260714: Create config health scoring tables (issue #22).
 *
 * - `config_health_snapshots`: append-only trend history — one row per instance per scored sweep,
 *   so health can be charted over time. Nullable FK + denormalized `instance_name` so history
 *   survives instance deletion (mirrors `sync_history`). Age + max-entries retention prunes it.
 * - `config_health_settings`: singleton (id=1) driving the recurring `config-health.snapshot` job
 *   (enable/disable, cadence, retention) and holding the CONFIGURABLE per-criterion enable/weight
 *   set as JSON. `trash_alignment` ships disabled (weight 0) — health starts simple and opt-in.
 *
 * Timestamps that drive scheduling/dedup (`last_run_at`, `backoff_until`, `generated_at`) are TEXT
 * ISO-8601 UTC to match jobQueue due-detection; bookkeeping columns use DATETIME CURRENT_TIMESTAMP.
 */
export const migration: Migration = {
  version: 20260714,
  name: 'Create config health scoring tables',

  up: `
		CREATE TABLE config_health_snapshots (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			arr_instance_id  INTEGER,
			instance_name    TEXT NOT NULL,
			arr_type         TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
			engine_version   TEXT NOT NULL,
			overall_score    INTEGER NOT NULL DEFAULT 0 CHECK (overall_score >= 0 AND overall_score <= 100),
			band             TEXT NOT NULL CHECK (band IN ('healthy', 'attention', 'needs-review', 'unknown')),
			criteria_scores  TEXT NOT NULL DEFAULT '[]',
			profile_scores   TEXT NOT NULL DEFAULT '[]',
			generated_at     TEXT NOT NULL,
			created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (arr_instance_id) REFERENCES arr_instances(id) ON DELETE SET NULL
		);

		CREATE INDEX idx_config_health_snapshots_generated
			ON config_health_snapshots(generated_at DESC);
		CREATE INDEX idx_config_health_snapshots_instance
			ON config_health_snapshots(arr_instance_id, generated_at DESC);

		CREATE TABLE config_health_settings (
			id                    INTEGER PRIMARY KEY CHECK (id = 1),
			enabled               INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			interval_minutes      INTEGER NOT NULL DEFAULT 360 CHECK (interval_minutes >= 5 AND interval_minutes <= 525600),
			retention_days        INTEGER NOT NULL DEFAULT 90 CHECK (retention_days > 0 AND retention_days <= 3650),
			retention_max_entries INTEGER NOT NULL DEFAULT 5000 CHECK (retention_max_entries > 0 AND retention_max_entries <= 1000000),
			criteria              TEXT NOT NULL DEFAULT '[]',
			last_run_at           TEXT,
			error_count           INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
			backoff_until         TEXT,
			sweep_cursor          INTEGER NOT NULL DEFAULT 0,
			sweep_started_at      TEXT,
			created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		INSERT INTO config_health_settings (id, criteria) VALUES (
			1,
			'[{"id":"completeness","enabled":true,"weight":30},{"id":"drift","enabled":true,"weight":30},{"id":"coherence","enabled":true,"weight":20},{"id":"compatibility","enabled":true,"weight":20},{"id":"trash_alignment","enabled":false,"weight":0}]'
		);
	`,

  down: `
		DROP INDEX IF EXISTS idx_config_health_snapshots_instance;
		DROP INDEX IF EXISTS idx_config_health_snapshots_generated;
		DROP TABLE IF EXISTS config_health_snapshots;
		DROP TABLE IF EXISTS config_health_settings;
	`,
};
