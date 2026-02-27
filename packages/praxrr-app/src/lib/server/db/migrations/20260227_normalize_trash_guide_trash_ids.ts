import type { Migration } from '../migrations.ts';

/**
 * Migration 20260227: Normalize TRaSH entity keys to lowercase.
 */
export const migration: Migration = {
	version: 20260227,
	name: 'Normalize TRaSH trash ids to lowercase',

	up: `
		-- Fail fast if lowercasing would collapse distinct rows into duplicates.
		-- Raise a custom error from a temporary staging trigger to keep behavior explicit.
		DROP TABLE IF EXISTS _migration_20260227_trash_guide_entity_cache_collision_check;
		CREATE TABLE _migration_20260227_trash_guide_entity_cache_collision_check (
			source_id INTEGER NOT NULL,
			entity_type TEXT NOT NULL,
			normalized_trash_id TEXT NOT NULL
		);

		DROP TRIGGER IF EXISTS trg_migration_20260227_trash_guide_entity_cache_collision_check;
		CREATE TRIGGER trg_migration_20260227_trash_guide_entity_cache_collision_check
		BEFORE INSERT ON _migration_20260227_trash_guide_entity_cache_collision_check
		WHEN EXISTS (
			SELECT 1
			FROM _migration_20260227_trash_guide_entity_cache_collision_check
			WHERE source_id = NEW.source_id
				AND entity_type = NEW.entity_type
				AND normalized_trash_id = NEW.normalized_trash_id
		)
		BEGIN
			SELECT RAISE(ABORT, 'Cannot normalize trash_guide_entity_cache due to lowercase collisions');
		END;

		INSERT INTO _migration_20260227_trash_guide_entity_cache_collision_check
			(source_id, entity_type, normalized_trash_id)
		SELECT source_id, entity_type, lower(trim(trash_id))
		FROM trash_guide_entity_cache;

		DROP TRIGGER IF EXISTS trg_migration_20260227_trash_guide_entity_cache_collision_check;
		DROP TABLE _migration_20260227_trash_guide_entity_cache_collision_check;

		DROP TABLE IF EXISTS _migration_20260227_trash_id_mappings_collision_check;
		CREATE TABLE _migration_20260227_trash_id_mappings_collision_check (
			source_id INTEGER NOT NULL,
			entity_type TEXT NOT NULL,
			normalized_trash_id TEXT NOT NULL
		);

		DROP TRIGGER IF EXISTS trg_migration_20260227_trash_id_mappings_collision_check;
		CREATE TRIGGER trg_migration_20260227_trash_id_mappings_collision_check
		BEFORE INSERT ON _migration_20260227_trash_id_mappings_collision_check
		WHEN EXISTS (
			SELECT 1
			FROM _migration_20260227_trash_id_mappings_collision_check
			WHERE source_id = NEW.source_id
				AND entity_type = NEW.entity_type
				AND normalized_trash_id = NEW.normalized_trash_id
		)
		BEGIN
			SELECT RAISE(ABORT, 'Cannot normalize trash_id_mappings due to lowercase collisions');
		END;

		INSERT INTO _migration_20260227_trash_id_mappings_collision_check
			(source_id, entity_type, normalized_trash_id)
		SELECT source_id, entity_type, lower(trim(trash_id))
		FROM trash_id_mappings;

		DROP TRIGGER IF EXISTS trg_migration_20260227_trash_id_mappings_collision_check;
		DROP TABLE _migration_20260227_trash_id_mappings_collision_check;

		UPDATE trash_guide_entity_cache
		SET trash_id = lower(trim(trash_id))
		WHERE trash_id != lower(trim(trash_id));

		UPDATE trash_id_mappings
		SET trash_id = lower(trim(trash_id))
		WHERE trash_id != lower(trim(trash_id));
	`,
};
