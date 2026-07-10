/**
 * Unified sanitizer for Arr write failures (issue #232).
 *
 * Splits a caught Arr write error into a stable, user-facing `reason` (safe to
 * surface in Sync History and apply responses) and `protectedDetails` (status,
 * body, cause) that belong only in protected server logs.
 *
 * The user-facing `reason` MUST NEVER be the raw `HttpError.message` — Arr error
 * bodies can embed request/response detail that should not leak to users. This
 * replaces the two ad-hoc `extractErrorDetails` copies (customFormats,
 * qualityProfiles) and metadata's inline `instanceof HttpError` check. See the
 * issue #232 design (D9).
 */

import { HttpError } from '$http/types.ts';

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

function classifyReason(error: unknown): string {
  if (error instanceof HttpError) {
    const status = error.status;
    if (status === 0) return 'Could not reach the Arr instance.';
    if (status === 408) return 'The Arr instance timed out.';
    if (status >= 400 && status < 500) return `The Arr instance rejected the request (HTTP ${status}).`;
    if (status >= 500) return `The Arr instance returned an error (HTTP ${status}).`;
    return 'The Arr instance write failed.';
  }
  return 'Sync write failed.';
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
