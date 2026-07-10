import { db } from '../db.ts';
import type { JobRunHistoryRecord, JobRunStatus, JobType } from '$jobs/queueTypes.ts';
import { parseSafeJobEvidence, type SafeJobEvidence } from '$shared/jobs/evidence.ts';

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
  evidence: string | null;
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
    // Tolerant parse: legacy/malformed/wrong-version blobs degrade to null, never throw.
    evidence: parseSafeJobEvidence(row.evidence),
    createdAt: row.created_at,
  };
}

export const jobRunHistoryQueries = {
  /**
   * Persist one job run. `evidence` is the structured safe durable record (issue #237); the
   * `error`/`output` columns are written as safe back-compat summaries derived from it, so
   * existing consumers (last-run error, per-queue latest run) keep working.
   */
  create(
    queueId: number | null,
    jobType: JobType,
    status: JobRunStatus,
    startedAt: string,
    finishedAt: string,
    durationMs: number,
    evidence: SafeJobEvidence
  ): number {
    const errorSummary = evidence.failure?.message ?? null;
    const outputSummary = evidence.output ?? evidence.decision ?? null;

    db.execute(
      `INSERT INTO job_run_history
			 (queue_id, job_type, status, started_at, finished_at, duration_ms, error, output, evidence)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      queueId,
      jobType,
      status,
      startedAt,
      finishedAt,
      durationMs,
      errorSummary,
      outputSummary,
      JSON.stringify(evidence)
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
