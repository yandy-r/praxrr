import type { Migration } from '../migrations.ts';

/**
 * Migration 20261023: Create arr_trash_guide_namespaces table (YAN-443 / #332).
 *
 * Persists a stable per-(Arr instance, TRaSH source) namespace index used to build the TRaSH
 * zero-width name suffix. Previously the index was positional over the resolvable sources, so
 * adding/removing/failing one source shifted every later source's suffix and caused Arr
 * overwrites and duplicates.
 *
 * `source_id` deliberately has NO foreign key to `trash_guide_sources`: a deleted source's row
 * must survive so its index (and the orphaned Arr entities carrying it) is never handed to a
 * different source. `trash_guide_sources.id` is AUTOINCREMENT, so ids are never reused and a
 * surviving row can never be adopted by a new source. Rows go away with their Arr instance.
 *
 * No backfill: indexes are assigned lazily (`MAX + 1` per instance, in hydration order, only to
 * sources resolving >= 1 profile), which reproduces the old positional numbering on first sync.
 */
export const migration: Migration = {
  version: 20261023,
  name: 'Create arr_trash_guide_namespaces table',

  up: `
		CREATE TABLE IF NOT EXISTS arr_trash_guide_namespaces (
			instance_id     INTEGER NOT NULL,
			source_id       INTEGER NOT NULL,
			namespace_index INTEGER NOT NULL CHECK (namespace_index >= 1),
			created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (instance_id, source_id),
			UNIQUE (instance_id, namespace_index),
			FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE
		);
	`,

  down: `DROP TABLE IF EXISTS arr_trash_guide_namespaces;`,
};
