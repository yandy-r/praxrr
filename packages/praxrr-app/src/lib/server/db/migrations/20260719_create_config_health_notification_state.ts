import type { Migration } from '../migrations.ts';

/**
 * Migration 20260719: Create per-instance Config Health notification state (issue #223).
 *
 * The state is independent from snapshot retention. A single row stores the last atomically claimed
 * degradation signature for each live Arr instance and is removed when that instance is deleted.
 */
export const migration: Migration = {
  version: 20260719,
  name: 'Create config health notification state',

  up: `
		CREATE TABLE config_health_notification_state (
			arr_instance_id    INTEGER PRIMARY KEY REFERENCES arr_instances(id) ON DELETE CASCADE,
			notified_signature TEXT NOT NULL CHECK (length(notified_signature) > 0),
			notified_at        TEXT NOT NULL,
			created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`,

  down: `
		DROP TABLE IF EXISTS config_health_notification_state;
	`,
};
