import type { Migration } from '../migrations.ts';

/**
 * Migration 20260227: Normalize TRaSH entity keys to lowercase.
 */
export const migration: Migration = {
	version: 20260227,
	name: 'Normalize TRaSH trash ids to lowercase',

	up: `
		DROP TABLE IF EXISTS _migration_20260227_trash_guide_entity_cache_collision_check;
		CREATE TABLE _migration_20260227_trash_guide_entity_cache_collision_check (
			source_id INTEGER NOT NULL,
			entity_type TEXT NOT NULL,
			normalized_trash_id TEXT NOT NULL,
			UNIQUE (source_id, entity_type, normalized_trash_id)
		);

		INSERT INTO _migration_20260227_trash_guide_entity_cache_collision_check
			(source_id, entity_type, normalized_trash_id)
		SELECT source_id, entity_type, lower(trim(trash_id))
		FROM trash_guide_entity_cache;

		DROP TABLE _migration_20260227_trash_guide_entity_cache_collision_check;

		DROP TABLE IF EXISTS _migration_20260227_trash_id_mappings_collision_check;
		CREATE TABLE _migration_20260227_trash_id_mappings_collision_check (
			source_id INTEGER NOT NULL,
			entity_type TEXT NOT NULL,
			normalized_trash_id TEXT NOT NULL,
			UNIQUE (source_id, entity_type, normalized_trash_id)
		);

		INSERT INTO _migration_20260227_trash_id_mappings_collision_check
			(source_id, entity_type, normalized_trash_id)
		SELECT source_id, entity_type, lower(trim(trash_id))
		FROM trash_id_mappings;

		DROP TABLE _migration_20260227_trash_id_mappings_collision_check;

		UPDATE trash_guide_entity_cache
		SET trash_id = lower(trim(trash_id))
		WHERE trash_id != lower(trim(trash_id));

		UPDATE trash_id_mappings
		SET trash_id = lower(trim(trash_id))
		WHERE trash_id != lower(trim(trash_id));
	`,
};
