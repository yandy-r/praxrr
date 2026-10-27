/**
 * Unified sanitizer for Arr write failures.
 *
 * Splits a caught Arr write error into a stable, user-facing `reason` (safe to
 * surface in Sync History and apply responses) and `protectedDetails` (status,
 * body, cause) that belong only in protected server logs.
 *
 * The user-facing `reason` MUST NEVER be the raw `HttpError.message` — Arr error
 * bodies can embed request/response detail that should not leak to users. This
 * replaces the ad-hoc error detail extraction in individual syncers.
 */

import { HttpError } from '$http/types.ts';

export type ArrWriteFailureCode = 'unreachable' | 'timeout' | 'rejected' | 'serverError' | 'internal';
export const SYNC_WRITE_FAILED_REASON = 'Sync write failed.';

interface HttpStatusFailure {
  code: ArrWriteFailureCode;
  reason: string;
}

const HTTP_STATUS_FAILURES: readonly {
  matches: (status: number) => boolean;
  describe: (status: number) => HttpStatusFailure;
}[] = [
  {
    matches: (status) => status === 0,
    describe: () => ({ code: 'unreachable', reason: 'Could not reach the Arr instance.' }),
  },
  { matches: (status) => status === 408, describe: () => ({ code: 'timeout', reason: 'The Arr instance timed out.' }) },
  {
    matches: (status) => status >= 400 && status < 500,
    describe: (status) => ({ code: 'rejected', reason: `The Arr instance rejected the request (HTTP ${status}).` }),
  },
  {
    matches: (status) => status >= 500,
    describe: (status) => ({ code: 'serverError', reason: `The Arr instance returned an error (HTTP ${status}).` }),
  },
  { matches: () => true, describe: () => ({ code: 'internal', reason: 'The Arr instance write failed.' }) },
];

export interface SanitizedArrWriteError {
  /** Stable, closed-vocabulary, user-facing reason. Never the raw Arr body. */
  reason: string;
  /** Diagnostics for protected server logs only — never surfaced to users. */
  protectedDetails: Record<string, unknown>;
}

/**
 * Classify a caught Arr write error into a sanitized user-facing reason plus
 * protected diagnostics. Handles network (status 0) and timeout (408) distinctly.
 */
export function sanitizeArrWriteError(error: unknown): SanitizedArrWriteError {
  return {
    reason: classifyReason(error),
    protectedDetails: extractProtectedDetails(error),
  };
}

/**
 * Closed-vocabulary user-facing reason for a numeric HTTP status. Shared with the
 * sync-history failure classifier so stored reasons and caught-error reasons can
 * never diverge.
 */
export function describeHttpStatus(status: number): HttpStatusFailure {
  return HTTP_STATUS_FAILURES.find((entry) => entry.matches(status))!.describe(status);
}

function classifyReason(error: unknown): string {
  if (error instanceof HttpError) {
    return describeHttpStatus(error.status).reason;
  }
  return SYNC_WRITE_FAILED_REASON;
}

/**
 * Collect the diagnostic fields the previous `extractErrorDetails` helpers logged
 * (status/statusText/response/body/data/cause). For protected logs only.
 */
function extractProtectedDetails(error: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {
    error: error instanceof Error ? error.message : 'Unknown error',
  };

  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if ('status' in err) details.status = err.status;
    if ('statusText' in err) details.statusText = err.statusText;
    if ('response' in err) details.response = err.response;
    if ('body' in err) details.responseBody = err.body;
    if ('data' in err) details.responseData = err.data;
    if (err.cause) details.cause = err.cause;
  }

  return details;
}
