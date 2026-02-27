import type { Migration } from '../migrations.ts';

/**
 * Migration 20260227: Normalize TRaSH entity keys to lowercase.
 */
export const migration: Migration = {
  version: 20260227,
  name: 'Normalize TRaSH trash ids to lowercase',

  up: `
		-- Fail fast if lowercasing would violate unique identity constraints.
		SELECT CASE
			WHEN EXISTS (
				SELECT 1
				FROM (
					SELECT source_id, entity_type, lower(trim(trash_id)) AS normalized_trash_id, COUNT(*) AS row_count
					FROM trash_guide_entity_cache
					GROUP BY source_id, entity_type, normalized_trash_id
					HAVING COUNT(*) > 1
				)
			)
			THEN RAISE(ABORT, 'Cannot normalize trash_guide_entity_cache due to lowercase collisions')
		END;

		SELECT CASE
			WHEN EXISTS (
				SELECT 1
				FROM (
					SELECT source_id, entity_type, lower(trim(trash_id)) AS normalized_trash_id, COUNT(*) AS row_count
					FROM trash_id_mappings
					GROUP BY source_id, entity_type, normalized_trash_id
					HAVING COUNT(*) > 1
				)
			)
			THEN RAISE(ABORT, 'Cannot normalize trash_id_mappings due to lowercase collisions')
		END;

		UPDATE trash_guide_entity_cache
		SET trash_id = lower(trim(trash_id))
		WHERE trash_id != lower(trim(trash_id));

		UPDATE trash_id_mappings
		SET trash_id = lower(trim(trash_id))
		WHERE trash_id != lower(trim(trash_id));
	`,
};
