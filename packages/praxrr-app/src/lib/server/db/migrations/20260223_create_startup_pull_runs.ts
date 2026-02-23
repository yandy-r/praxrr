import type { Migration } from '../migrations.ts';

/**
 * Migration 20260223: Create startup_pull_runs and startup_pull_instance_outcomes tables
 *
 * Provides dedicated persistence for startup pull run summaries and per-instance
 * outcome details beyond what job_run_history payload stores. Tables are additive
 * and do not modify existing job history schema.
 *
 * - startup_pull_runs: one row per startup pull execution with aggregate counters
 * - startup_pull_instance_outcomes: per-instance counters and status for each run
 */
export const migration: Migration = {
  version: 20260223,
  name: 'Create startup pull run tables',
  up: `
		CREATE TABLE startup_pull_runs (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			started_at TEXT NOT NULL,
			finished_at TEXT,
			imported INTEGER NOT NULL DEFAULT 0,
			skipped_default INTEGER NOT NULL DEFAULT 0,
			skipped_no_match INTEGER NOT NULL DEFAULT 0,
			conflicted INTEGER NOT NULL DEFAULT 0,
			failed INTEGER NOT NULL DEFAULT 0,
			instances_total INTEGER NOT NULL DEFAULT 0,
			instances_failed INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE startup_pull_instance_outcomes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id TEXT NOT NULL,
			instance_id INTEGER NOT NULL,
			instance_name TEXT NOT NULL,
			arr_type TEXT NOT NULL,
			status TEXT NOT NULL,
			imported INTEGER NOT NULL DEFAULT 0,
			skipped_default INTEGER NOT NULL DEFAULT 0,
			skipped_no_match INTEGER NOT NULL DEFAULT 0,
			conflicted INTEGER NOT NULL DEFAULT 0,
			failed INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (run_id) REFERENCES startup_pull_runs(id) ON DELETE CASCADE,
			FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE
		);

		CREATE INDEX idx_startup_pull_runs_started_at ON startup_pull_runs(started_at);
		CREATE INDEX idx_startup_pull_runs_status ON startup_pull_runs(status);
		CREATE INDEX idx_startup_pull_instance_outcomes_run_id ON startup_pull_instance_outcomes(run_id);
		CREATE INDEX idx_startup_pull_instance_outcomes_instance_id ON startup_pull_instance_outcomes(instance_id);
	`,
  down: `
		DROP INDEX IF EXISTS idx_startup_pull_instance_outcomes_instance_id;
		DROP INDEX IF EXISTS idx_startup_pull_instance_outcomes_run_id;
		DROP INDEX IF EXISTS idx_startup_pull_runs_status;
		DROP INDEX IF EXISTS idx_startup_pull_runs_started_at;
		DROP TABLE IF EXISTS startup_pull_instance_outcomes;
		DROP TABLE IF EXISTS startup_pull_runs;
	`,
};
