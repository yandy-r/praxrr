import type { Migration } from '../migrations.ts';

/**
 * Migration 20260720: Record confirmed per-entity sync outcomes (issue #232).
 *
 * Adds three additive columns to the existing `sync_history` audit table:
 * - `entity_outcomes`: JSON blob of confirmed per-entity terminal outcomes captured from the
 *   ACTUAL Arr writes (create/update/delete + success/skipped/failed), distinct from the planned
 *   preview `changes` blob. Follows the established `changes`/`section_results` blob pattern.
 * - `entity_outcome_count`: denormalized count for list summaries (blob stays out of summaries).
 * - `preview_id`: correlates a run back to the reviewed sync preview it applied (plan↔run).
 *
 * Pure audit columns — no PCD base ops, so `seedBuiltInBaseOps.ts` is intentionally untouched.
 */
export const migration: Migration = {
  version: 20260720,
  name: 'Add sync history entity outcomes',

  up: `
		ALTER TABLE sync_history ADD COLUMN entity_outcomes TEXT NOT NULL DEFAULT '[]';
		ALTER TABLE sync_history ADD COLUMN entity_outcome_count INTEGER NOT NULL DEFAULT 0;
		ALTER TABLE sync_history ADD COLUMN preview_id TEXT;

		CREATE INDEX idx_sync_history_preview ON sync_history(preview_id);
	`,

  down: `
		DROP INDEX IF EXISTS idx_sync_history_preview;
		ALTER TABLE sync_history DROP COLUMN preview_id;
		ALTER TABLE sync_history DROP COLUMN entity_outcome_count;
		ALTER TABLE sync_history DROP COLUMN entity_outcomes;
	`,
};
