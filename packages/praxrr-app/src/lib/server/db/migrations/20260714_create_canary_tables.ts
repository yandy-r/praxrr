import type { Migration } from '../migrations.ts';

/**
 * Migration 20260714: Create canary sync / blast-radius tables (issue #19).
 *
 * - `canary_rollouts`: one row per canary rollout. Drives the resumable batched
 *   rollout state machine (`canary_running` -> `awaiting_confirmation` ->
 *   `rolling_out` -> `completed`/`aborted`/`failed`). A rollout is scoped to
 *   exactly one `arr_type` with no sibling fallback. The `canary_instance_id`
 *   FK is nullable `ON DELETE SET NULL` and `canary_instance_name` is
 *   denormalized so rollout rows survive instance deletion (the
 *   `sync_history` audit pattern). `canary_sync_history_id` links the canary
 *   run to its full diagnostics row. `state_token` is the double-proceed value
 *   guard (`markRollingOut`/`abort`); `remaining_targets`/`rollout_results` are
 *   JSON blobs and `batch_cursor` tracks resumable batch progress.
 * - `canary_settings`: singleton (id=1) driving the global opt-in flag, default
 *   batch size, auto-select behavior, default canary instance, and default
 *   partial policy.
 *
 * Timestamp convention (matches 20260710_create_sync_history_tables): `started_at`
 * / `finished_at` are ISO-8601 UTC TEXT written from JS; `created_at` /
 * `updated_at` are bookkeeping `CURRENT_TIMESTAMP`.
 */
export const migration: Migration = {
  version: 20260714,
  name: 'Create canary tables',

  up: `
		CREATE TABLE canary_rollouts (
			id                     INTEGER PRIMARY KEY AUTOINCREMENT,
			arr_type               TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
			status                 TEXT NOT NULL CHECK (status IN ('canary_running', 'awaiting_confirmation', 'rolling_out', 'completed', 'aborted', 'failed')),
			canary_instance_id     INTEGER REFERENCES arr_instances(id) ON DELETE SET NULL,
			canary_instance_name   TEXT NOT NULL,
			canary_status          TEXT CHECK (canary_status IN ('success', 'partial', 'failed', 'skipped') OR canary_status IS NULL),
			canary_sync_history_id INTEGER REFERENCES sync_history(id) ON DELETE SET NULL,
			sections               TEXT,
			max_batch_size         INTEGER NOT NULL DEFAULT 1 CHECK (max_batch_size >= 1),
			partial_policy         TEXT NOT NULL DEFAULT 'gate' CHECK (partial_policy IN ('gate', 'abort')),
			canary_output          TEXT,
			canary_error           TEXT,
			remaining_targets      TEXT NOT NULL DEFAULT '[]',
			batch_cursor           INTEGER NOT NULL DEFAULT 0,
			rollout_results        TEXT NOT NULL DEFAULT '[]',
			trigger                TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'system', 'schedule')),
			started_at             TEXT NOT NULL,
			finished_at            TEXT,
			state_token            TEXT NOT NULL,
			created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX idx_canary_rollouts_status ON canary_rollouts(status);
		CREATE INDEX idx_canary_rollouts_arr_type_started ON canary_rollouts(arr_type, started_at DESC);

		CREATE TABLE canary_settings (
			id                         INTEGER PRIMARY KEY CHECK (id = 1),
			enabled                    INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
			default_max_batch_size     INTEGER NOT NULL DEFAULT 1 CHECK (default_max_batch_size >= 1),
			auto_select                INTEGER NOT NULL DEFAULT 1 CHECK (auto_select IN (0, 1)),
			default_canary_instance_id INTEGER REFERENCES arr_instances(id) ON DELETE SET NULL,
			default_partial_policy     TEXT NOT NULL DEFAULT 'gate' CHECK (default_partial_policy IN ('gate', 'abort')),
			created_at                 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at                 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		INSERT INTO canary_settings (id) VALUES (1);
	`,

  down: `
		DROP INDEX IF EXISTS idx_canary_rollouts_arr_type_started;
		DROP INDEX IF EXISTS idx_canary_rollouts_status;
		DROP TABLE IF EXISTS canary_rollouts;
		DROP TABLE IF EXISTS canary_settings;
	`,
};
