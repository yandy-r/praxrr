import type { Migration } from '../migrations.ts';

/**
 * Migration 20261103: Drift remediation (reconcile / acknowledge+snooze / opt-in auto).
 *
 * - `drift_instance_status` gains the drift-event stamp (`drift_detected_at`), suppression
 *   state (instance ack by signature, per-entity ack keys, snooze), the last remediation
 *   outcome + sync_history back-pointer, and the auto-remediation idempotency key.
 * - `drift_remediation_policy`: per-instance mode (`off` | `notify` | `auto`) + allowed
 *   sections. No row == `off`, so existing instances keep today's behavior without backfill.
 * - `sync_history` gains the server-owned drift link (signature, detected-at, trigger) with a
 *   partial index for drift-linked lookups.
 *
 * Additive only: existing rows read as no ack, no snooze, policy off.
 * See docs/plans/drift-remediation/plan.md §2.
 */
export const migration: Migration = {
  version: 20261103,
  name: 'Add drift remediation',

  up: `
		ALTER TABLE drift_instance_status ADD COLUMN drift_detected_at TEXT;
		ALTER TABLE drift_instance_status ADD COLUMN acknowledged_signature TEXT;
		ALTER TABLE drift_instance_status ADD COLUMN acknowledged_at TEXT;
		ALTER TABLE drift_instance_status ADD COLUMN acknowledged_entity_keys TEXT NOT NULL DEFAULT '[]';
		ALTER TABLE drift_instance_status ADD COLUMN snoozed_until TEXT;
		ALTER TABLE drift_instance_status ADD COLUMN last_remediation_trigger TEXT
			CHECK (last_remediation_trigger IN ('reconcile', 'auto') OR last_remediation_trigger IS NULL);
		ALTER TABLE drift_instance_status ADD COLUMN last_remediation_status TEXT
			CHECK (
				last_remediation_status IN ('success', 'partial', 'failed', 'skipped', 'held_canary')
				OR last_remediation_status IS NULL
			);
		ALTER TABLE drift_instance_status ADD COLUMN last_remediation_signature TEXT;
		ALTER TABLE drift_instance_status ADD COLUMN last_remediation_at TEXT;
		ALTER TABLE drift_instance_status ADD COLUMN last_remediation_sync_history_id INTEGER
			REFERENCES sync_history(id) ON DELETE SET NULL;
		ALTER TABLE drift_instance_status ADD COLUMN last_auto_attempt_signature TEXT;

		CREATE TABLE drift_remediation_policy (
			arr_instance_id  INTEGER PRIMARY KEY REFERENCES arr_instances(id) ON DELETE CASCADE,
			arr_type         TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
			mode             TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'notify', 'auto')),
			allowed_sections TEXT NOT NULL DEFAULT '[]',
			created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		ALTER TABLE sync_history ADD COLUMN drift_signature TEXT;
		ALTER TABLE sync_history ADD COLUMN drift_detected_at TEXT;
		ALTER TABLE sync_history ADD COLUMN remediation_trigger TEXT
			CHECK (remediation_trigger IN ('reconcile', 'auto') OR remediation_trigger IS NULL);

		CREATE INDEX idx_sync_history_drift ON sync_history(arr_instance_id, drift_signature)
			WHERE drift_signature IS NOT NULL;
	`,

  down: `
		DROP INDEX IF EXISTS idx_sync_history_drift;
		ALTER TABLE sync_history DROP COLUMN remediation_trigger;
		ALTER TABLE sync_history DROP COLUMN drift_detected_at;
		ALTER TABLE sync_history DROP COLUMN drift_signature;

		DROP TABLE IF EXISTS drift_remediation_policy;

		ALTER TABLE drift_instance_status DROP COLUMN last_auto_attempt_signature;
		ALTER TABLE drift_instance_status DROP COLUMN last_remediation_sync_history_id;
		ALTER TABLE drift_instance_status DROP COLUMN last_remediation_at;
		ALTER TABLE drift_instance_status DROP COLUMN last_remediation_signature;
		ALTER TABLE drift_instance_status DROP COLUMN last_remediation_status;
		ALTER TABLE drift_instance_status DROP COLUMN last_remediation_trigger;
		ALTER TABLE drift_instance_status DROP COLUMN snoozed_until;
		ALTER TABLE drift_instance_status DROP COLUMN acknowledged_entity_keys;
		ALTER TABLE drift_instance_status DROP COLUMN acknowledged_at;
		ALTER TABLE drift_instance_status DROP COLUMN acknowledged_signature;
		ALTER TABLE drift_instance_status DROP COLUMN drift_detected_at;
	`,
};
