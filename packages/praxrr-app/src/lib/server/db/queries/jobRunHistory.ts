import { db } from '../db.ts';
import type { JobRunHistoryRecord, JobRunStatus, JobType } from '$jobs/queueTypes.ts';

interface JobRunHistoryRow {
  id: number;
  queue_id: number | null;
  job_type: JobType;
  status: JobRunStatus;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  error: string | null;
  output: string | null;
  created_at: string;
}

function rowToRecord(row: JobRunHistoryRow): JobRunHistoryRecord {
  return {
    id: row.id,
    queueId: row.queue_id,
    jobType: row.job_type,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    error: row.error,
    output: row.output,
    createdAt: row.created_at,
  };
}

/**
 * Database queries for job run history.
 * Records completed job executions with status, duration, and error details.
 */
export const jobRunHistoryQueries = {
  create(
    queueId: number | null,
    jobType: JobType,
    status: JobRunStatus,
    startedAt: string,
    finishedAt: string,
    durationMs: number,
    error?: string,
    output?: string
  ): number {
    db.execute(
      `INSERT INTO job_run_history
			 (queue_id, job_type, status, started_at, finished_at, duration_ms, error, output)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      queueId,
      jobType,
      status,
      startedAt,
      finishedAt,
      durationMs,
      error ?? null,
      output ?? null
    );

    const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
    return result?.id ?? 0;
  },

  getRecent(limit: number = 100): JobRunHistoryRecord[] {
    const rows = db.query<JobRunHistoryRow>(`SELECT * FROM job_run_history ORDER BY started_at DESC LIMIT ?`, limit);
    return rows.map(rowToRecord);
  },

  getByQueueId(queueId: number, limit: number = 1): JobRunHistoryRecord[] {
    const rows = db.query<JobRunHistoryRow>(
      `SELECT * FROM job_run_history WHERE queue_id = ? ORDER BY started_at DESC LIMIT ?`,
      queueId,
      limit
    );
    return rows.map(rowToRecord);
  },
};
