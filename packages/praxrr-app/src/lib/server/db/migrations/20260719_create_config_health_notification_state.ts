import type { Migration } from '../migrations.ts';

/**
 * Migration 20260719: Create per-instance Config Health notification state (issue #223).
 *
 * The state is independent from snapshot retention. A single row stores the monotonic snapshot
 * high-water mark plus the last atomically claimed degradation signature for each live Arr instance.
 */
export const migration: Migration = {
  version: 20260719,
  name: 'Create config health notification state',

  up: `
		CREATE TABLE config_health_notification_state (
			arr_instance_id     INTEGER PRIMARY KEY REFERENCES arr_instances(id) ON DELETE CASCADE,
			last_snapshot_id    INTEGER NOT NULL CHECK (last_snapshot_id > 0),
			notified_signature  TEXT CHECK (notified_signature IS NULL OR length(notified_signature) > 0),
			notified_at         TEXT,
			notified_snapshot_id INTEGER CHECK (notified_snapshot_id IS NULL OR notified_snapshot_id > 0),
			created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CHECK (
				(notified_signature IS NULL AND notified_at IS NULL AND notified_snapshot_id IS NULL)
				OR
				(notified_signature IS NOT NULL AND notified_at IS NOT NULL AND notified_snapshot_id IS NOT NULL)
			)
		);

		CREATE INDEX idx_config_health_snapshots_instance_id_desc
			ON config_health_snapshots(arr_instance_id, id DESC);
	`,

  down: `
		DROP INDEX IF EXISTS idx_config_health_snapshots_instance_id_desc;
		DROP TABLE IF EXISTS config_health_notification_state;
	`,
};
