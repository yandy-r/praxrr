import { db } from '../db.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { JobRunStatus } from '$jobs/queueTypes.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import type { StartupPullRunStatus } from '$lib/server/pull/startup/types.ts';

interface StartupPullRunRow {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  imported: number;
  skipped_default: number;
  skipped_no_match: number;
  conflicted: number;
  failed: number;
  instances_total: number;
  instances_failed: number;
  created_at: string;
}

interface StartupPullInstanceOutcomeRow {
  id: number;
  run_id: string;
  instance_id: number;
  instance_name: string;
  arr_type: string;
  status: string;
  imported: number;
  skipped_default: number;
  skipped_no_match: number;
  conflicted: number;
  failed: number;
  created_at: string;
}

export interface StartupPullRunRecord {
  id: string;
  status: StartupPullRunStatus;
  startedAt: string;
  finishedAt: string | null;
  imported: number;
  skippedDefault: number;
  skippedNoMatch: number;
  conflicted: number;
  failed: number;
  instancesTotal: number;
  instancesFailed: number;
  createdAt: string;
}

export interface StartupPullInstanceOutcomeRecord {
  id: number;
  runId: string;
  instanceId: number;
  instanceName: string;
  arrType: ArrAppType;
  status: JobRunStatus;
  imported: number;
  skippedDefault: number;
  skippedNoMatch: number;
  conflicted: number;
  failed: number;
  createdAt: string;
}

export interface StartupPullRunSummaryRecord extends StartupPullRunRecord {
  instances: StartupPullInstanceOutcomeRecord[];
}

export interface InsertStartupPullRunInput {
  id: string;
  status: StartupPullRunStatus;
  startedAt: string;
  finishedAt: string | null;
  imported: number;
  skippedDefault: number;
  skippedNoMatch: number;
  conflicted: number;
  failed: number;
  instancesTotal: number;
  instancesFailed: number;
}

export interface InsertStartupPullInstanceOutcomeInput {
  runId: string;
  instanceId: number;
  instanceName: string;
  arrType: ArrAppType;
  status: JobRunStatus;
  imported: number;
  skippedDefault: number;
  skippedNoMatch: number;
  conflicted: number;
  failed: number;
}

function runRowToRecord(row: StartupPullRunRow): StartupPullRunRecord {
  return {
    id: row.id,
    status: parseStartupPullRunStatus(row.status),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    imported: row.imported,
    skippedDefault: row.skipped_default,
    skippedNoMatch: row.skipped_no_match,
    conflicted: row.conflicted,
    failed: row.failed,
    instancesTotal: row.instances_total,
    instancesFailed: row.instances_failed,
    createdAt: row.created_at,
  };
}

function outcomeRowToRecord(row: StartupPullInstanceOutcomeRow): StartupPullInstanceOutcomeRecord {
  return {
    id: row.id,
    runId: row.run_id,
    instanceId: row.instance_id,
    instanceName: row.instance_name,
    arrType: parseArrType(row.arr_type),
    status: parseJobRunStatus(row.status),
    imported: row.imported,
    skippedDefault: row.skipped_default,
    skippedNoMatch: row.skipped_no_match,
    conflicted: row.conflicted,
    failed: row.failed,
    createdAt: row.created_at,
  };
}

function parseJobRunStatus(status: string): JobRunStatus {
  switch (status) {
    case 'success':
    case 'failure':
    case 'skipped':
    case 'cancelled':
      return status;
  }

  throw new Error(`Invalid JobRunStatus value: ${status}`);
}

function parseStartupPullRunStatus(status: string): StartupPullRunStatus {
  switch (status) {
    case 'success':
    case 'partial':
    case 'failed':
    case 'skipped':
    case 'disabled':
      return status;
  }

  throw new Error(`Invalid StartupPullRunStatus value: ${status}`);
}

function parseArrType(arrType: string): ArrAppType {
  if (!isArrAppType(arrType)) {
    throw new Error(`Invalid ArrAppType value: ${arrType}`);
  }

  return arrType;
}

/**
 * Database queries for startup pull runs.
 * Records the outcomes of PCD pull operations performed at application startup,
 * including per-instance import, skip, conflict, and failure counts.
 */
export const startupPullQueries = {
  insertRun(input: InsertStartupPullRunInput): void {
    db.execute(
      `INSERT INTO startup_pull_runs
			 (id, status, started_at, finished_at, imported, skipped_default, skipped_no_match, conflicted, failed, instances_total, instances_failed)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.status,
      input.startedAt,
      input.finishedAt,
      input.imported,
      input.skippedDefault,
      input.skippedNoMatch,
      input.conflicted,
      input.failed,
      input.instancesTotal,
      input.instancesFailed
    );
  },

  insertInstanceOutcome(input: InsertStartupPullInstanceOutcomeInput): void {
    db.execute(
      `INSERT INTO startup_pull_instance_outcomes
			 (run_id, instance_id, instance_name, arr_type, status, imported, skipped_default, skipped_no_match, conflicted, failed)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.runId,
      input.instanceId,
      input.instanceName,
      input.arrType,
      input.status,
      input.imported,
      input.skippedDefault,
      input.skippedNoMatch,
      input.conflicted,
      input.failed
    );
  },

  getLatest(): StartupPullRunRecord | undefined {
    const row = db.queryFirst<StartupPullRunRow>('SELECT * FROM startup_pull_runs ORDER BY started_at DESC LIMIT 1');
    return row ? runRowToRecord(row) : undefined;
  },

  getById(id: string): StartupPullRunRecord | undefined {
    const row = db.queryFirst<StartupPullRunRow>('SELECT * FROM startup_pull_runs WHERE id = ?', id);
    return row ? runRowToRecord(row) : undefined;
  },

  getLatestWithOutcomes(): StartupPullRunSummaryRecord | undefined {
    const run = this.getLatest();
    if (!run) return undefined;

    const outcomeRows = db.query<StartupPullInstanceOutcomeRow>(
      'SELECT * FROM startup_pull_instance_outcomes WHERE run_id = ? ORDER BY instance_id',
      run.id
    );

    return {
      ...run,
      instances: outcomeRows.map(outcomeRowToRecord),
    };
  },

  getByIdWithOutcomes(id: string): StartupPullRunSummaryRecord | undefined {
    const run = this.getById(id);
    if (!run) return undefined;

    const outcomeRows = db.query<StartupPullInstanceOutcomeRow>(
      'SELECT * FROM startup_pull_instance_outcomes WHERE run_id = ? ORDER BY instance_id',
      run.id
    );

    return {
      ...run,
      instances: outcomeRows.map(outcomeRowToRecord),
    };
  },

  getInstanceOutcomes(runId: string): StartupPullInstanceOutcomeRecord[] {
    const rows = db.query<StartupPullInstanceOutcomeRow>(
      'SELECT * FROM startup_pull_instance_outcomes WHERE run_id = ? ORDER BY instance_id',
      runId
    );
    return rows.map(outcomeRowToRecord);
  },

  getRecent(limit: number = 50): StartupPullRunRecord[] {
    const rows = db.query<StartupPullRunRow>('SELECT * FROM startup_pull_runs ORDER BY started_at DESC LIMIT ?', limit);
    return rows.map(runRowToRecord);
  },

  deleteOlderThan(days: number): number {
    return db.execute(
      `DELETE FROM startup_pull_runs
			 WHERE datetime(started_at) < datetime('now', '-' || ? || ' days')`,
      days
    );
  },

  getCount(): number {
    const result = db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM startup_pull_runs');
    return result?.count ?? 0;
  },
};
