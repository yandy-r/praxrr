import type { Migration } from '../migrations.ts';

/**
 * Migration 20260724: Create the durable plugin registry (issue #264).
 *
 * Plugin identity is the exact API-version namespace plus a case-insensitive plugin id. The
 * validated manifest is retained verbatim as JSON while lifecycle columns support cheap management
 * queries. This is Praxrr app state, not a PCD/base-op table.
 */
export const migration: Migration = {
  version: 20260724,
  name: 'Create plugin registry',

  up: `
		CREATE TABLE plugin_registry (
			api_version     TEXT NOT NULL CHECK (LENGTH(api_version) > 0),
			plugin_id       TEXT NOT NULL CHECK (LENGTH(plugin_id) > 0),
			manifest_json   TEXT NOT NULL,
			enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			discovered      INTEGER NOT NULL DEFAULT 1 CHECK (discovered IN (0, 1)),
			lifecycle_state TEXT NOT NULL DEFAULT 'registered' CHECK (
				lifecycle_state IN ('discovered', 'validated', 'registered', 'rejected', 'activated', 'failed', 'unloaded')
			),
			last_error      TEXT,
			registered_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE UNIQUE INDEX idx_plugin_registry_identity
			ON plugin_registry(api_version, plugin_id COLLATE NOCASE);
		CREATE INDEX idx_plugin_registry_availability
			ON plugin_registry(api_version, discovered, enabled);
		CREATE INDEX idx_plugin_registry_lifecycle
			ON plugin_registry(lifecycle_state);
		CREATE INDEX idx_plugin_registry_tombstone_retention
			ON plugin_registry(discovered, updated_at DESC, api_version, plugin_id COLLATE NOCASE);
	`,

  down: `
		DROP INDEX IF EXISTS idx_plugin_registry_tombstone_retention;
		DROP INDEX IF EXISTS idx_plugin_registry_lifecycle;
		DROP INDEX IF EXISTS idx_plugin_registry_availability;
		DROP INDEX IF EXISTS idx_plugin_registry_identity;
		DROP TABLE IF EXISTS plugin_registry;
	`,
};
