import type { Migration } from '../migrations.ts';

/**
 * Migration 20261020: Add setup checklist dismissal timestamp
 *
 * After the setup wizard is skipped, a "Finish setup" checklist stays visible
 * until every prerequisite is met or the user dismisses it permanently. This
 * nullable column records that permanent dismissal. Additive and
 * non-destructive: existing rows default to NULL (checklist not dismissed).
 */

export const migration: Migration = {
  version: 20261020,
  name: 'Add setup checklist dismissed_at',

  up: `
		ALTER TABLE setup_state ADD COLUMN setup_checklist_dismissed_at TEXT;
	`,

  down: `
		ALTER TABLE setup_state DROP COLUMN setup_checklist_dismissed_at;
	`,
};
