import type { Migration } from '../migrations.ts';

/**
 * Migration 050: Create user interface preferences table
 * - Stores per-user section visibility mode preferences
 */
export const migration: Migration = {
  version: 50,
  name: 'Create user interface preferences table',
  up: `
		CREATE TABLE user_interface_preferences (
			user_id INTEGER NOT NULL,
			section_key TEXT NOT NULL CHECK (LENGTH(TRIM(section_key)) > 0 AND LENGTH(TRIM(section_key)) <= 96),
			mode TEXT NOT NULL CHECK (mode IN ('basic', 'advanced')),
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);

		CREATE UNIQUE INDEX idx_user_interface_preferences_user_section
			ON user_interface_preferences(user_id, section_key);

		CREATE INDEX idx_user_interface_preferences_user_id
			ON user_interface_preferences(user_id);
	`,
  down: `
		DROP INDEX IF EXISTS idx_user_interface_preferences_user_id;
		DROP INDEX IF EXISTS idx_user_interface_preferences_user_section;
		DROP TABLE IF EXISTS user_interface_preferences;
	`,
};
