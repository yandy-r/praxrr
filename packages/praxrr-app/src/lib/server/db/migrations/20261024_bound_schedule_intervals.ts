import type { Migration } from '../migrations.ts';

/**
 * Migration 20261024: Bound persisted schedule intervals (YAN-470 / #336).
 *
 * Unbounded drift `interval_minutes` and TRaSH/PCD `sync_strategy` values could be persisted large
 * enough to overflow Date arithmetic in the scheduler, which threw during startup job init. The cap
 * is MAX_SCHEDULE_INTERVAL_MINUTES (525600 = 1 year) from `$jobs/scheduleUtils.ts`.
 *
 * - `drift_check_settings`: clamp the singleton, then rebuild with
 *   `CHECK (interval_minutes >= 5 AND interval_minutes <= 525600)`. Nothing FK-references this
 *   singleton, so the create/copy/drop/rename rebuild is safe inside the migration transaction.
 * - `trash_guide_sources.sync_strategy` and `database_instances.sync_strategy`: clamp into
 *   [0, 525600] only. Both are FK targets, so they are NOT rebuilt to add a CHECK (rebuilding an
 *   FK-referenced table inside a transaction is unsafe; see YAN-480). Route validators and the
 *   scheduler's clamp enforce the bound going forward.
 *
 * `down` restores the original `>= 5` CHECK; clamped values stay clamped.
 */
export const migration: Migration = {
  version: 20261024,
  name: 'Bound schedule intervals',

  up: `
		UPDATE drift_check_settings SET interval_minutes = 525600 WHERE interval_minutes > 525600;

		CREATE TABLE drift_check_settings_new (
			id               INTEGER PRIMARY KEY CHECK (id = 1),
			enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (interval_minutes >= 5 AND interval_minutes <= 525600),
			last_run_at      TEXT,
			error_count      INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
			backoff_until    TEXT,
			sweep_cursor     INTEGER NOT NULL DEFAULT 0,
			sweep_started_at TEXT,
			created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		INSERT INTO drift_check_settings_new (
			id, enabled, interval_minutes, last_run_at, error_count, backoff_until,
			sweep_cursor, sweep_started_at, created_at, updated_at
		)
		SELECT
			id, enabled, interval_minutes, last_run_at, error_count, backoff_until,
			sweep_cursor, sweep_started_at, created_at, updated_at
		FROM drift_check_settings;

		DROP TABLE drift_check_settings;
		ALTER TABLE drift_check_settings_new RENAME TO drift_check_settings;

		UPDATE trash_guide_sources SET sync_strategy = 525600 WHERE sync_strategy > 525600;
		UPDATE trash_guide_sources SET sync_strategy = 0 WHERE sync_strategy < 0;

		UPDATE database_instances SET sync_strategy = 525600 WHERE sync_strategy > 525600;
		UPDATE database_instances SET sync_strategy = 0 WHERE sync_strategy < 0;
	`,

  down: `
		CREATE TABLE drift_check_settings_old (
			id               INTEGER PRIMARY KEY CHECK (id = 1),
			enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (interval_minutes >= 5),
			last_run_at      TEXT,
			error_count      INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
			backoff_until    TEXT,
			sweep_cursor     INTEGER NOT NULL DEFAULT 0,
			sweep_started_at TEXT,
			created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		INSERT INTO drift_check_settings_old (
			id, enabled, interval_minutes, last_run_at, error_count, backoff_until,
			sweep_cursor, sweep_started_at, created_at, updated_at
		)
		SELECT
			id, enabled, interval_minutes, last_run_at, error_count, backoff_until,
			sweep_cursor, sweep_started_at, created_at, updated_at
		FROM drift_check_settings;

		DROP TABLE drift_check_settings;
		ALTER TABLE drift_check_settings_old RENAME TO drift_check_settings;
	`,
};
