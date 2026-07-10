import type { Migration } from '../migrations.ts';

/**
 * Migration 20260722: add the safe durable evidence column to job_run_history (issue #237).
 *
 * Plain nullable TEXT column holding a JSON {@link SafeJobEvidence} blob. Legacy rows keep
 * `evidence = NULL` on purpose: NULL means "structured evidence not captured", so old
 * free-form `error`/`output` are never presented as newly validated evidence. No backfill,
 * no default, no index (the column is never a query predicate).
 */
export const migration: Migration = {
  version: 20260722,
  name: 'Add safe durable evidence to job_run_history',
  up: `
		ALTER TABLE job_run_history ADD COLUMN evidence TEXT;
	`,
  down: `
		ALTER TABLE job_run_history DROP COLUMN evidence;
	`,
};
