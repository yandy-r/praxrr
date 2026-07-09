import type { Migration } from '../migrations.ts';

/**
 * Migration 20260711: Create the quality goal bindings table (issue #20).
 *
 * Stores INTENT metadata only — which goal (preset + slider weights + engine version) last generated
 * a quality profile's scoring — one upserted row per (database, profile, arr_type). The actual scores
 * live in `pcd_ops` (single source of truth), so this binding can never fork the scoring system;
 * deleting it never touches scores. Powers reopen-at-last-position, slider-diff-vs-last-applied,
 * engine-version staleness detection, and override-drift surfacing.
 *
 * `arr_type` is CHECK-constrained to the slice's apply scope (radarr/sonarr). `applied_at` is TEXT
 * ISO-8601 UTC; bookkeeping columns use DATETIME DEFAULT CURRENT_TIMESTAMP.
 */
export const migration: Migration = {
  version: 20260711,
  name: 'Create quality goal bindings',

  up: `
		CREATE TABLE quality_goal_bindings (
			database_id    INTEGER NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
			profile_name   TEXT NOT NULL,
			arr_type       TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr')),
			preset_id      TEXT NOT NULL,
			weights_json   TEXT NOT NULL,
			engine_version TEXT NOT NULL,
			applied_at     TEXT NOT NULL,
			created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (database_id, profile_name, arr_type)
		);
	`,

  down: `
		DROP TABLE IF EXISTS quality_goal_bindings;
	`
};
