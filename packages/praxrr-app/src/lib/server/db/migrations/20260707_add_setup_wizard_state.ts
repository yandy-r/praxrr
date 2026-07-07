import type { Migration } from '../migrations.ts';

/**
 * Migration 20260707: Add setup wizard state
 *
 * Extends setup_state to track the setup wizard's completion status,
 * dismissal timestamp, and current step.
 */

export const migration: Migration = {
  version: 20260707,
  name: 'Add setup wizard state',

  up: `
		ALTER TABLE setup_state ADD COLUMN wizard_completed INTEGER NOT NULL DEFAULT 0;
		ALTER TABLE setup_state ADD COLUMN wizard_dismissed_at TEXT;
		ALTER TABLE setup_state ADD COLUMN wizard_current_step TEXT NOT NULL DEFAULT 'welcome';
	`,

  down: `
		ALTER TABLE setup_state DROP COLUMN wizard_completed;
		ALTER TABLE setup_state DROP COLUMN wizard_dismissed_at;
		ALTER TABLE setup_state DROP COLUMN wizard_current_step;
	`,
};
