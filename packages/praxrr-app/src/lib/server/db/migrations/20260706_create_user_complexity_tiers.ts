import type { Migration } from '../migrations.ts';

/**
 * Migration 20260706: Create user complexity tiers table
 * - Stores per-user section complexity tier and progression counters
 */
export const migration: Migration = {
  version: 20260706,
  name: 'Create user complexity tiers table',
  up: `
		CREATE TABLE user_complexity_tiers (
			user_id INTEGER NOT NULL,
			section_key TEXT NOT NULL CHECK (LENGTH(TRIM(section_key)) > 0 AND LENGTH(TRIM(section_key)) <= 96),
			tier TEXT NOT NULL CHECK (tier IN ('beginner', 'intermediate', 'advanced')),
			interaction_count INTEGER NOT NULL DEFAULT 0 CHECK (interaction_count >= 0 AND interaction_count <= 1000000),
			advanced_toggle_count INTEGER NOT NULL DEFAULT 0 CHECK (advanced_toggle_count >= 0),
			last_suggested_tier TEXT CHECK (last_suggested_tier IS NULL OR last_suggested_tier IN ('beginner', 'intermediate', 'advanced')),
			suggestion_dismissed_at DATETIME,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);

		CREATE UNIQUE INDEX idx_user_complexity_tiers_user_section
			ON user_complexity_tiers(user_id, section_key);

		CREATE INDEX idx_user_complexity_tiers_user_id
			ON user_complexity_tiers(user_id);
	`,
  down: `
		DROP INDEX IF EXISTS idx_user_complexity_tiers_user_id;
		DROP INDEX IF EXISTS idx_user_complexity_tiers_user_section;
		DROP TABLE IF EXISTS user_complexity_tiers;
	`,
};
