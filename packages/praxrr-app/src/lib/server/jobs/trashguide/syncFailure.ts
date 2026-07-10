/**
 * TRaSH sync failure classification (issue #238).
 *
 * Maps a known terminal outcome to a typed, closed, SAFE {@link TrashGuideSyncFailureReason}
 * (`{ code, message, recoveryAction }`). The copy is pre-authored — it never embeds raw exception
 * text, git/parser diagnostics, credentials, repository URLs, or hostnames — so no secret-shaped
 * string can leak into the persisted evidence, the API response, or the initiating UI.
 *
 * Full diagnostics stay only behind the sanitized logger boundary in the handler. This module
 * mirrors `$sync/preview/failureReason.ts`; it deliberately does NOT inspect any message string.
 */

import type { TrashGuideSyncFailureCode, TrashGuideSyncFailureReason } from '../queueTypes.ts';

interface FailureCopy {
  message: string;
  recoveryAction: string;
}

/** Pre-authored, safe copy for every closed failure code. */
const FAILURE_COPY: Record<TrashGuideSyncFailureCode, FailureCopy> = {
  source_missing: {
    message: 'The TRaSH source no longer exists.',
    recoveryAction: 'Re-add the TRaSH source, then run the sync again.'
  },
  source_disabled: {
    message: 'The TRaSH source is disabled.',
    recoveryAction: 'Enable the source in its settings, then run the sync again.'
  },
  network: {
    message: 'Could not reach the TRaSH repository.',
    recoveryAction: 'Check network connectivity to the repository host, then retry the sync.'
  },
  parser_failed: {
    message: 'The TRaSH guide data failed parser or schema validation.',
    recoveryAction: 'Wait for the upstream guide to be corrected, then retry the sync.'
  },
  sync_failed: {
    message: 'The TRaSH sync did not complete successfully.',
    recoveryAction: 'Retry the sync; if it keeps failing, check the server logs for details.'
  },
  internal: {
    message: 'An unexpected error occurred while syncing the TRaSH source.',
    recoveryAction: 'Retry the sync; if the problem persists, check the server logs for details.'
  }
};

/** Codes a user can meaningfully retry by re-running the sync (drives transported `retry.retryable`). */
const RETRYABLE_CODES: ReadonlySet<TrashGuideSyncFailureCode> = new Set<TrashGuideSyncFailureCode>([
  'network',
  'parser_failed',
  'sync_failed',
  'internal'
]);

/** Build a typed, safe failure reason for a known code. */
export function buildTrashGuideSyncFailure(code: TrashGuideSyncFailureCode): TrashGuideSyncFailureReason {
  const { message, recoveryAction } = FAILURE_COPY[code];
  return { code, message, recoveryAction };
}

/**
 * Whether a failure code is retryable by re-running the sync.
 *
 * Config-level failures (`source_missing`/`source_disabled`) are NOT retryable — the operator must
 * fix the source first. This is the only driver of the transported `retry.retryable` flag; it never
 * depends on raw-message inspection.
 */
export function isRetryableFailureCode(code: TrashGuideSyncFailureCode): boolean {
  return RETRYABLE_CODES.has(code);
}
