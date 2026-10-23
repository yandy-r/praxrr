import type { Migration } from '../migrations.ts';

/** Record only entities Praxrr creates; existing Arr entities are not backfilled. */
export const migration: Migration = {
  version: 20261025,
  name: 'Create arr_managed_entities table and pruning policy',

  up: `
		ALTER TABLE arr_instances ADD COLUMN prune_removed_managed INTEGER NOT NULL DEFAULT 0
			CHECK (prune_removed_managed IN (0, 1));

		CREATE TABLE IF NOT EXISTS arr_managed_entities (
			instance_id INTEGER NOT NULL REFERENCES arr_instances(id) ON DELETE CASCADE,
			section TEXT NOT NULL CHECK (section = 'qualityProfiles'),
			entity_type TEXT NOT NULL CHECK (entity_type IN ('customFormat', 'qualityProfile')),
			remote_id INTEGER NOT NULL CHECK (remote_id > 0),
			arr_name TEXT NOT NULL,
			pcd_name TEXT NOT NULL,
			database_id INTEGER NOT NULL CHECK (database_id > 0),
			source_kind TEXT NOT NULL CHECK (source_kind IN ('pcd', 'trash')),
			first_synced_at TEXT NOT NULL,
			last_synced_at TEXT NOT NULL,
			PRIMARY KEY (instance_id, entity_type, remote_id)
		);
	`,

  down: `
		DROP TABLE IF EXISTS arr_managed_entities;
		ALTER TABLE arr_instances DROP COLUMN prune_removed_managed;
	`,
};
