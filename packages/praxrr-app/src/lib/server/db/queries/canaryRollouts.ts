import { db } from '../db.ts';
import type { SectionType } from '$sync/types.ts';
import type {
  CanaryArrType,
  CanaryInstanceResult,
  CanaryOutcomeStatus,
  CanaryPartialPolicy,
  CanaryRolloutDetail,
  CanaryRolloutRow,
  CanaryRolloutStatus,
  CanaryRolloutSummary,
  CanaryTarget,
  CanaryTrigger,
} from '$lib/server/sync/canary/types.ts';

/**
 * Queries for `canary_rollouts` (issue #19). A rollout is scoped to exactly one
 * `arr_type` (no sibling fallback) and moves through a guarded lifecycle:
 * `canary_running` -> (`awaiting_confirmation` | `aborted` | `failed`) ->
 * `rolling_out` -> (`completed` | `failed` | `aborted`).
 *
 * Every state transition is a value-guarded UPDATE (status and/or `state_token`)
 * so a stale caller cannot double-proceed or resurrect a terminal row. Guarded
 * mutators return `db.execute(...) > 0`. Mirrors the raw-SQL query-module shape of
 * `pcdRollbacks.ts` / `syncHistory.ts`.
 */

/** Fields required to open a rollout in `canary_running` state. */
export interface InsertCanaryRolloutInput {
  arrType: CanaryArrType;
  canaryInstanceId: number | null;
  canaryInstanceName: string;
  sections: SectionType[] | null;
  maxBatchSize: number;
  partialPolicy: CanaryPartialPolicy;
  remainingTargets: CanaryTarget[];
  trigger: CanaryTrigger;
  startedAt: string;
  stateToken: string;
}

/**
 * Fields recorded once the canary sync classifies. `status` is the gate decision
 * (`awaiting_confirmation` to hold, or terminal `aborted`/`failed`); `nextToken`
 * re-issues `state_token` so the token captured before the canary ran can no
 * longer authorize a proceed. `finishedAt` is set only on a terminal transition.
 */
export interface RecordCanaryOutcomeInput {
  status: CanaryRolloutStatus;
  canaryStatus: CanaryOutcomeStatus;
  canaryOutput: string | null;
  canaryError: string | null;
  canarySyncHistoryId: number | null;
  nextToken: string;
  finishedAt: string | null;
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const SUMMARY_COLUMNS = `id, arr_type, status, canary_instance_id, canary_instance_name, canary_status,
	max_batch_size, partial_policy, remaining_targets, rollout_results, trigger,
	started_at, finished_at, created_at, updated_at`;

/**
 * List-row projection. Heavy blobs and `state_token` are NOT exposed;
 * `remainingCount`/`completedCount` derive from the array lengths.
 */
function rowToSummary(row: CanaryRolloutRow): CanaryRolloutSummary {
  return {
    id: row.id,
    arrType: row.arr_type as CanaryArrType,
    status: row.status as CanaryRolloutStatus,
    canaryInstanceId: row.canary_instance_id,
    canaryInstanceName: row.canary_instance_name,
    canaryStatus: (row.canary_status as CanaryOutcomeStatus | null) ?? null,
    maxBatchSize: row.max_batch_size,
    partialPolicy: row.partial_policy as CanaryPartialPolicy,
    remainingCount: parseJsonArray<CanaryTarget>(row.remaining_targets).length,
    completedCount: parseJsonArray<CanaryInstanceResult>(row.rollout_results).length,
    trigger: row.trigger as CanaryTrigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Full detail — decoded blobs and the current `state_token`. */
function rowToDetail(row: CanaryRolloutRow): CanaryRolloutDetail {
  return {
    id: row.id,
    arrType: row.arr_type as CanaryArrType,
    status: row.status as CanaryRolloutStatus,
    canaryInstanceId: row.canary_instance_id,
    canaryInstanceName: row.canary_instance_name,
    canaryStatus: (row.canary_status as CanaryOutcomeStatus | null) ?? null,
    canarySyncHistoryId: row.canary_sync_history_id,
    sections: row.sections ? parseJsonArray<SectionType>(row.sections) : null,
    maxBatchSize: row.max_batch_size,
    partialPolicy: row.partial_policy as CanaryPartialPolicy,
    canaryOutput: row.canary_output,
    canaryError: row.canary_error,
    remainingTargets: parseJsonArray<CanaryTarget>(row.remaining_targets),
    batchCursor: row.batch_cursor,
    rolloutResults: parseJsonArray<CanaryInstanceResult>(row.rollout_results),
    trigger: row.trigger as CanaryTrigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    stateToken: row.state_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const canaryRolloutQueries = {
  /** Open a rollout in `canary_running` state. Returns the new row id. */
  insert(input: InsertCanaryRolloutInput): number {
    db.execute(
      `INSERT INTO canary_rollouts (
				arr_type, status, canary_instance_id, canary_instance_name, sections,
				max_batch_size, partial_policy, remaining_targets, trigger, started_at, state_token
			) VALUES (?, 'canary_running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.arrType,
      input.canaryInstanceId,
      input.canaryInstanceName,
      input.sections ? JSON.stringify(input.sections) : null,
      input.maxBatchSize,
      input.partialPolicy,
      JSON.stringify(input.remainingTargets),
      input.trigger,
      input.startedAt,
      input.stateToken
    );
    const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
    return row?.id ?? 0;
  },

  /** Full detail for a single rollout, or undefined if unknown. */
  getById(id: number): CanaryRolloutDetail | undefined {
    const row = db.queryFirst<CanaryRolloutRow>('SELECT * FROM canary_rollouts WHERE id = ?', id);
    return row ? rowToDetail(row) : undefined;
  },

  /** Paginated list of summaries, newest first (stable id tiebreak). */
  listRecent(limit: number, offset: number): CanaryRolloutSummary[] {
    const rows = db.query<CanaryRolloutRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM canary_rollouts
			ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
      limit,
      offset
    );
    return rows.map(rowToSummary);
  },

  /**
   * Record the classified canary outcome and apply the gate decision. Guarded to
   * `canary_running` so a re-run cannot overwrite an already-decided rollout;
   * re-issues `state_token` to `nextToken`.
   */
  recordCanaryOutcome(id: number, input: RecordCanaryOutcomeInput): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = ?, canary_status = ?, canary_output = ?, canary_error = ?,
					canary_sync_history_id = ?, state_token = ?, finished_at = ?,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'canary_running'`,
        input.status,
        input.canaryStatus,
        input.canaryOutput,
        input.canaryError,
        input.canarySyncHistoryId,
        input.nextToken,
        input.finishedAt,
        id
      ) > 0
    );
  },

  /**
   * Transition the gate to `rolling_out`. Value-guarded on both the current
   * `awaiting_confirmation` state and the caller's `expectedToken` (the real
   * double-proceed guard); re-issues `state_token` to `nextToken`.
   */
  markRollingOut(id: number, expectedToken: string, nextToken: string): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = 'rolling_out', state_token = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'awaiting_confirmation' AND state_token = ?`,
        nextToken,
        id,
        expectedToken
      ) > 0
    );
  },

  /** Advance the batch cursor and persist accumulated results. Guarded to `rolling_out`. */
  recordBatchProgress(id: number, batchCursor: number, rolloutResults: CanaryInstanceResult[]): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					batch_cursor = ?, rollout_results = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'rolling_out'`,
        batchCursor,
        JSON.stringify(rolloutResults),
        id
      ) > 0
    );
  },

  /** Terminal transition of the rollout run. Guarded to `rolling_out`. */
  finishRollout(id: number, status: 'completed' | 'failed', finishedAt: string): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = ?, finished_at = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'rolling_out'`,
        status,
        finishedAt,
        id
      ) > 0
    );
  },

  /**
   * Abort at the gate. Value-guarded on `awaiting_confirmation` and the caller's
   * `expectedToken` so a stale gate view cannot abort a rollout that already
   * proceeded.
   */
  abort(id: number, expectedToken: string, finishedAt: string): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = 'aborted', finished_at = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'awaiting_confirmation' AND state_token = ?`,
        finishedAt,
        id,
        expectedToken
      ) > 0
    );
  },
};
