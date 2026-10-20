import type { Migration } from '../migrations.ts';

/**
 * Migration 20261022: Add notification history attempt count
 *
 * Notification delivery now retries transient failures (network error, 408, 429,
 * 5xx). This column records the highest attempt number reached by a delivery
 * (1 = first-try success). Additive and non-destructive: existing rows default
 * to 1 (they were sent exactly once, without retry).
 */

export const migration: Migration = {
  version: 20261022,
  name: 'Add notification history attempts',

  up: `
		ALTER TABLE notification_history ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
	`,

  down: `
		ALTER TABLE notification_history DROP COLUMN attempts;
	`,
};
