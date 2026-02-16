import type { Migration } from '../migrations.ts';

/**
 * Migration 20260218: Add external_url to arr_instances
 *
 * Adds an optional browser-facing URL used for Open-in links. Existing API
 * integrations should continue to use arr_instances.url.
 */

export const migration: Migration = {
  version: 20260218,
  name: 'Add external_url to arr_instances',

  up: `
		ALTER TABLE arr_instances
		ADD COLUMN external_url TEXT;
	`,
};
