import type { Migration } from '../migrations.ts';

/**
 * Migration 20261030: Create user command palette recents (YAN-588).
 *
 * Additive table holding one JSON-encoded, server-validated recents list per user for the global
 * command palette. Kept separate from `user_interface_preferences`, whose `mode` CHECK constraint
 * only allows disclosure modes. Non-destructive: no existing table is altered.
 */
export const migration: Migration = {
  version: 20261030,
  name: 'Create user command palette recents',

  up: `
		CREATE TABLE IF NOT EXISTS user_command_palette_recents (
			user_id INTEGER PRIMARY KEY,
			recents_json TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);
	`,

  down: `
		DROP TABLE IF EXISTS user_command_palette_recents;
	`,
};
