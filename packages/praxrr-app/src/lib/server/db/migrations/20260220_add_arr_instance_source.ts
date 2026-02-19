import type { Migration } from '../migrations.ts';

/**
 * Migration 20260220: Add source to arr_instances
 *
 * Tracks whether an instance was created via UI or environment configuration.
 */

export const migration: Migration = {
	version: 20260220,
	name: 'Add source to arr_instances',

	up: `
		ALTER TABLE arr_instances
		ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
	`,
};
