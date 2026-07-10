/**
 * Safe durable job evidence — shared, pure contract (issue #237).
 *
 * This module holds ONLY the typed vocabulary and pure helpers for the durable
 * evidence a queued job leaves in Job History. It has no server imports so the DB
 * query layer, the dispatcher, and any client renderer type against one source.
 *
 * Safety model: {@link SafeJobEvidence} is safe BY CONSTRUCTION. `failure.message`
 * and `recovery` are pre-authored copy looked up by a closed {@link JobFailureCode}
 * (see `$jobs/evidence.ts` `FAILURE_COPY`); raw exception text, Arr/HTTP response
 * bodies, credentials, hostnames, and stack traces never enter this record — they
 * are logged through the sanitized logger boundary only.
 */

/** Bumped only on a breaking shape change; read paths treat a mismatch as "not captured". */
export const JOB_EVIDENCE_SCHEMA_VERSION = 1 as const;

/**
 * Closed vocabulary of queued-job failure reasons.
 *
 * Every value is assigned by the handler branch or by matching a thrown error's
 * TYPE/status (never by parsing message text), so no raw or secret-shaped string can
 * influence the code. Anything untyped collapses to `internalError`.
 */
export type JobFailureCode =
  | 'invalidPayload'
  | 'targetNotFound'
  | 'unsupported'
  | 'precondition'
  | 'credential'
  | 'upstream'
  | 'timeout'
  | 'gitNetwork'
  | 'filesystem'
  | 'database'
  | 'validation'
  | 'handlerNotFound'
  | 'internalError';

/** Typed, closed, safe failure evidence. `message` is pre-authored copy, never raw text. */
export interface SafeJobFailure {
  readonly code: JobFailureCode;
  readonly message: string;
}

/**
 * The durable, safe evidence persisted for one job run.
 *
 * All string fields are pre-authored copy or bounded, config-derived summaries; none
 * carry raw exception/response/credential text. `failure`/`recovery` are non-null only
 * for a failed run. Persisted as JSON in `job_run_history.evidence`; a NULL column means
 * a legacy run whose structured evidence was never captured.
 */
export interface SafeJobEvidence {
  readonly schemaVersion: number;
  /** Human-readable subject (instance/database/source name), bounded, or null. */
  readonly target: string | null;
  /** Short safe summary of the decision/skip/cancel context, bounded, or null. */
  readonly decision: string | null;
  /** Safe count/summary of what the run produced, bounded, or null. */
  readonly output: string | null;
  /** Typed failure reason (code + pre-authored message); null unless the run failed. */
  readonly failure: SafeJobFailure | null;
  /** Pre-authored recovery hint; null unless the run failed. */
  readonly recovery: string | null;
}

/** Per-field bounds (UTF-16 code units) applied before persistence. */
export const JOB_EVIDENCE_BOUNDS = {
  target: 200,
  decision: 300,
  output: 2000,
  recovery: 300,
} as const;

const ELLIPSIS = '…';

/**
 * Bound a string to `max` UTF-16 code units, iterating by code point so surrogate pairs
 * are never split. Appends a single-character ellipsis when truncation occurs, reserving
 * room for it. Code-point safe (not full grapheme-cluster safe); the cap protects the DB
 * column, not visual correctness. Empty in → empty out.
 */
export function boundString(value: string, max: number): string {
  if (value.length <= max) return value;
  let result = '';
  for (const character of value) {
    if (result.length + character.length > max - ELLIPSIS.length) break;
    result += character;
  }
  return `${result}${ELLIPSIS}`;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Tolerant structural guard for a persisted evidence blob. Deliberately does NOT validate
 * `failure.code` against {@link JobFailureCode} — a code written by a newer server must
 * still round-trip, because the read path renders the STORED `message`/`recovery`, never
 * re-derives them.
 */
export function isSafeJobEvidence(value: unknown): value is SafeJobEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== JOB_EVIDENCE_SCHEMA_VERSION) return false;
  if (
    !isStringOrNull(record.target) ||
    !isStringOrNull(record.decision) ||
    !isStringOrNull(record.output) ||
    !isStringOrNull(record.recovery)
  ) {
    return false;
  }
  if (record.failure !== null) {
    if (typeof record.failure !== 'object' || record.failure === null) return false;
    const failure = record.failure as Record<string, unknown>;
    if (typeof failure.code !== 'string' || typeof failure.message !== 'string') return false;
  }
  return true;
}

/**
 * Parse a persisted evidence column into {@link SafeJobEvidence}. Tolerant on the read
 * path: a NULL/empty column, malformed JSON, a wrong schema version, or a structurally
 * invalid blob all collapse to `null` ("legacy / evidence not captured") rather than
 * throwing, so one bad row never breaks the whole Job History query.
 */
export function parseSafeJobEvidence(raw: string | null): SafeJobEvidence | null {
  if (raw == null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isSafeJobEvidence(parsed) ? parsed : null;
}
