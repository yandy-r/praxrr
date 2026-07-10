import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { coerceTrashGuideSourceArrType } from '$shared/trashguide/types.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import type {
  TrashGuideSyncJobPayload,
  TrashGuideSyncRunEvidence,
  TrashGuideSyncStatusView
} from '../queueTypes.ts';

const TRASHGUIDE_SYNC_DEDUPE_KEY_PREFIX = 'trashguide.sync:';

/** Stable dedupe/correlation slot key for a source's sync job (one slot per source). */
export function getTrashGuideSyncDedupeKey(sourceId: number): string {
  return `${TRASHGUIDE_SYNC_DEDUPE_KEY_PREFIX}${sourceId}`;
}

export type TrashGuideSyncEnqueueTrigger = 'manual' | 'scheduled';

export interface EnqueueTrashGuideSyncResult {
  status: 'queued' | 'already_running';
  runToken: string;
  view: TrashGuideSyncStatusView;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readRunToken(payload: Record<string, unknown> | undefined): string | undefined {
  return payload ? readString(payload.runToken) : undefined;
}

/**
 * Safely parse structured terminal evidence from a `job_run_history.output` string.
 *
 * Returns `null` for empty output, non-JSON legacy free-text summaries, or any payload without the
 * current `schemaVersion`, so a pre-#238 run row degrades gracefully instead of throwing.
 */
export function parseTrashGuideSyncRunEvidence(output: string | null): TrashGuideSyncRunEvidence | null {
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    if (parsed && typeof parsed === 'object' && (parsed as { schemaVersion?: unknown }).schemaVersion === 1) {
      return parsed as TrashGuideSyncRunEvidence;
    }
  } catch {
    // Legacy free-text output (older runs) carries no structured evidence.
  }

  return null;
}

/**
 * Build the single wire view of a source's current queue slot + latest terminal run (issue #238).
 *
 * This is the one place identity is resolved (live source -> queue-payload snapshot -> evidence
 * snapshot -> null) so the POST response and the GET status resolver can never drift.
 */
export function getTrashGuideSyncStatus(sourceId: number): TrashGuideSyncStatusView {
  const source = trashGuideSourcesQueries.getById(sourceId);
  const slot = jobQueueQueries.getByDedupeKey(getTrashGuideSyncDedupeKey(sourceId));
  const queueId = slot?.id ?? null;
  const latest = queueId !== null ? jobRunHistoryQueries.getByQueueId(queueId, 1)[0] : undefined;
  const evidence = latest ? parseTrashGuideSyncRunEvidence(latest.output) : null;

  const snapshotName = readString(slot?.payload?.sourceName);
  const snapshotArrType = coerceTrashGuideSourceArrType(slot?.payload?.sourceArrType);
  const liveArrType = source ? coerceTrashGuideSourceArrType(source.arr_type) : null;

  return {
    sourceId,
    sourceName: source?.name ?? snapshotName ?? evidence?.source.name ?? null,
    arrType: liveArrType ?? snapshotArrType ?? evidence?.source.arrType ?? null,
    queueId,
    current: slot
      ? {
          status: slot.status,
          runAt: slot.runAt,
          startedAt: slot.startedAt,
          attempts: slot.attempts,
          runToken: readRunToken(slot.payload) ?? null
        }
      : null,
    latestRun: latest
      ? {
          id: latest.id,
          status: latest.status,
          startedAt: latest.startedAt,
          finishedAt: latest.finishedAt,
          durationMs: latest.durationMs,
          evidence
        }
      : null
  };
}

/**
 * Enqueue (or coalesce onto) a TRaSH source sync — the shared path used by BOTH the manual route and
 * the scheduler.
 *
 * Correlation-token rules (issue #238):
 * - existing slot is `running` -> dedupe onto it, returning that run's token (no new work).
 * - existing slot is `queued`  -> REUSE its token so re-clicks / a scheduler tick converge on one run.
 * - otherwise                  -> mint a fresh token.
 *
 * Durable identity (`sourceName`/`sourceArrType`) is snapshotted on EVERY enqueue so a scheduled tick
 * can never strip a pending manual snapshot and a since-deleted source stays identifiable.
 */
export function enqueueTrashGuideSourceSync(input: {
  sourceId: number;
  trigger: TrashGuideSyncEnqueueTrigger;
  runAt?: string;
}): EnqueueTrashGuideSyncResult {
  const { sourceId, trigger } = input;
  const dedupeKey = getTrashGuideSyncDedupeKey(sourceId);
  const existing = jobQueueQueries.getByDedupeKey(dedupeKey);

  if (existing?.status === 'running') {
    return {
      status: 'already_running',
      runToken: readRunToken(existing.payload) ?? '',
      view: getTrashGuideSyncStatus(sourceId)
    };
  }

  const runToken =
    (existing?.status === 'queued' ? readRunToken(existing.payload) : undefined) ?? crypto.randomUUID();

  const source = trashGuideSourcesQueries.getById(sourceId);
  const sourceName = source?.name;
  const sourceArrType = source ? (coerceTrashGuideSourceArrType(source.arr_type) ?? undefined) : undefined;

  const requestedAt = new Date().toISOString();
  const runAt = input.runAt ?? requestedAt;
  const payload: TrashGuideSyncJobPayload = {
    sourceId,
    trigger,
    requestedAt,
    runToken,
    ...(sourceName !== undefined ? { sourceName } : {}),
    ...(sourceArrType !== undefined ? { sourceArrType } : {})
  };

  const job = jobQueueQueries.upsertScheduled({
    jobType: 'trashguide.sync',
    runAt,
    payload,
    source: trigger === 'manual' ? 'manual' : 'schedule',
    dedupeKey
  });

  // The slot may have started running between the read and the upsert; treat that as already-running.
  if (job.status === 'running') {
    return {
      status: 'already_running',
      runToken: readRunToken(job.payload) ?? runToken,
      view: getTrashGuideSyncStatus(sourceId)
    };
  }

  return { status: 'queued', runToken, view: getTrashGuideSyncStatus(sourceId) };
}

/**
 * Enqueue a MANUAL TRaSH source sync and wake the dispatcher.
 *
 * Thin manual-trigger wrapper over {@link enqueueTrashGuideSourceSync}; only the manual path nudges
 * the dispatcher (scheduled sweeps are driven by the scheduler tick).
 */
export function enqueueManualTrashGuideSourceSync(sourceId: number): EnqueueTrashGuideSyncResult {
  const result = enqueueTrashGuideSourceSync({ sourceId, trigger: 'manual' });
  if (result.status === 'queued' && result.view.current) {
    jobDispatcher.notifyJobEnqueued(result.view.current.runAt);
  }
  return result;
}
