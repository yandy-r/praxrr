import type { Migration } from '../migrations.ts';
import { db } from '../db.ts';

/**
 * Migration 20260725: Persist plugin-ecosystem enablement on general_settings.
 *
 * Replaces the operator-facing `PLUGINS_ENABLED` environment master gate with a DB-backed
 * opt-in (default off). One-time seed: if legacy `PLUGINS_ENABLED` is truthy and the column
 * is still 0, set it to 1 so existing deployments do not silently flip off after upgrade.
 */
function seedPluginsEnabledFromLegacyEnv(): void {
  const raw = Deno.env.get('PLUGINS_ENABLED')?.trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on'].includes(raw ?? '')) {
    return;
  }

  db.execute(
    `UPDATE general_settings
		 SET plugins_enabled = 1, updated_at = CURRENT_TIMESTAMP
		 WHERE id = 1 AND plugins_enabled = 0`
  );
}

export const migration: Migration = {
  version: 20260725,
  name: 'Add plugins_enabled to general_settings',

  up: `
		ALTER TABLE general_settings
			ADD COLUMN plugins_enabled INTEGER NOT NULL DEFAULT 0
			CHECK (plugins_enabled IN (0, 1));
	`,

  down: `
		-- SQLite cannot DROP COLUMN with a CHECK constraint portably across older builds;
		-- recreate without plugins_enabled.
		CREATE TABLE general_settings_rollback (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			apply_default_delay_profiles INTEGER NOT NULL DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		INSERT INTO general_settings_rollback (id, apply_default_delay_profiles, created_at, updated_at)
		SELECT id, apply_default_delay_profiles, created_at, updated_at FROM general_settings;
		DROP TABLE general_settings;
		ALTER TABLE general_settings_rollback RENAME TO general_settings;
	`,

  afterUp: seedPluginsEnabledFromLegacyEnv,
};
