import type { Migration } from '../migrations.ts';

/**
 * Migration 20260708: Add detected application version to arr_instances
 *
 * Persists the raw application version observed via getSystemStatus() plus the
 * timestamp of the last successful detection. Both are nullable — NULL means the
 * version has never been detected, which the compatibility resolver treats as
 * the optimistic `unknown` tier. Support tier and feature availability are
 * derived at read time and never stored, so re-authoring ARR_SUPPORT_RANGES
 * reclassifies every instance with zero backfill.
 */

export const migration: Migration = {
  version: 20260708,
  name: 'Add detected application version to arr_instances',

  up: `
		ALTER TABLE arr_instances ADD COLUMN detected_version TEXT;
		ALTER TABLE arr_instances ADD COLUMN detected_at TEXT;
	`,

  down: `
		ALTER TABLE arr_instances DROP COLUMN detected_at;
		ALTER TABLE arr_instances DROP COLUMN detected_version;
	`,
};
