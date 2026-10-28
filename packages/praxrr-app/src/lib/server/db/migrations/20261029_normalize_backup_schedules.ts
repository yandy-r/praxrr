import type { Migration } from '../migrations.ts';

/**
 * Migration 20261029: Normalize backup schedules (YAN-453).
 *
 * The backup UI used to offer pseudo-schedule strings (an "every 6 hours" / "every 12 hours"
 * spelling) that croner cannot parse, so `calculateNextRunFromSchedule` silently fell back to
 * +1h and backups ran far more often than configured. Rewrite them to the equivalent cron
 * expressions the UI now emits. Everything else (keywords hourly/daily/weekly/monthly and
 * real cron) is already valid and untouched.
 *
 * `down` restores the legacy spellings so a rollback matches pre-migration rows.
 */
export const migration: Migration = {
  version: 20261029,
  name: 'Normalize backup schedules to cron',

  up: `
		UPDATE backup_settings SET schedule = '0 */6 * * *' WHERE schedule = '*/6 hours';
		UPDATE backup_settings SET schedule = '0 */12 * * *' WHERE schedule = '*/12 hours';
	`,

  down: `
		UPDATE backup_settings SET schedule = '*/6 hours' WHERE schedule = '0 */6 * * *';
		UPDATE backup_settings SET schedule = '*/12 hours' WHERE schedule = '0 */12 * * *';
	`,
};
