import type { Migration } from '../migrations.ts';

/**
 * Migration 20260723: Persist Canary remaining-target preview evidence (issue #239).
 *
 * The nullable JSON TEXT column deliberately has no default or backfill. Existing rollouts and
 * in-progress rows therefore retain NULL, which the query layer treats as unavailable evidence;
 * historical lifecycle facts are never rewritten or upgraded to an available preview.
 */
export const migration: Migration = {
  version: 20260723,
  name: 'Add canary preview evidence',

  up: `
		ALTER TABLE canary_rollouts ADD COLUMN remaining_preview_evidence TEXT;
	`,

  down: `
		ALTER TABLE canary_rollouts DROP COLUMN remaining_preview_evidence;
	`,
};
