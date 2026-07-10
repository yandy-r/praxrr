/**
 * Sync Preview failure classification.
 *
 * Maps a caught error to a typed, closed, SAFE {@link SyncPreviewFailureReason}
 * (`{ code, message, recoveryAction }`). Classification is anchored on error TYPE and
 * numeric HTTP status ONLY — never on substring/message parsing — so no raw exception
 * text or secret-shaped string can influence the code assignment or leak into the
 * transported evidence. Anything untyped collapses to the `internalError` catch-all.
 *
 * Full diagnostics are intentionally NOT carried here; callers log the raw error through
 * the sanitized logger boundary (`sanitizeLogMeta`) instead. `HttpError.response` (the raw
 * Arr response body) is never read here so it cannot reach the user surface.
 */

import { HttpError } from '$http/types.ts';
import type { SyncPreviewArrType, SyncPreviewFailureCode, SyncPreviewFailureReason } from './types.ts';

function arrLabel(arrType: SyncPreviewArrType | undefined): string {
  switch (arrType) {
    case 'radarr':
      return 'Radarr';
    case 'sonarr':
      return 'Sonarr';
    case 'lidarr':
      return 'Lidarr';
    default:
      return 'the Arr';
  }
}

type CopyBuilder = (arr: string) => { message: string; recoveryAction: string };

/**
 * Pre-authored, safe copy for every closed failure code. Messages may name the Arr family
 * (safe closed metadata) but never embed instance-specific or raw error text.
 */
const FAILURE_COPY: Record<SyncPreviewFailureCode, CopyBuilder> = {
  unreachable: (arr) => ({
    message: `Could not reach the ${arr} instance.`,
    recoveryAction: `Confirm the instance URL is correct and that ${arr} is running and reachable from Praxrr, then try again.`
  }),
  timeout: (arr) => ({
    message: `The ${arr} instance did not respond in time.`,
    recoveryAction: `Check the instance's load and network latency, then retry.`
  }),
  unauthorized: (arr) => ({
    message: `The ${arr} instance rejected the API key.`,
    recoveryAction: `Update the API key for this instance in its settings, then regenerate the preview.`
  }),
  notFound: (arr) => ({
    message: `A required ${arr} resource was not found.`,
    recoveryAction: `Verify the instance URL and that its API version is supported, then regenerate the preview.`
  }),
  rejected: (arr) => ({
    message: `The ${arr} instance rejected the request.`,
    recoveryAction: `Review the instance configuration for compatibility, then regenerate the preview.`
  }),
  serverError: (arr) => ({
    message: `The ${arr} instance returned a server error.`,
    recoveryAction: `Check the ${arr} instance's own logs, then retry once it recovers.`
  }),
  sectionErrors: () => ({
    message: 'One or more preview sections could not be generated.',
    recoveryAction: 'Regenerate the preview to retry the failed sections before applying.'
  }),
  executionFailed: () => ({
    message: 'The sync run did not complete successfully.',
    recoveryAction: 'Review the per-entity outcomes, resolve the reported issues, then apply again.'
  }),
  stale: () => ({
    message: 'This preview is too old to apply safely.',
    recoveryAction: 'Regenerate the preview, then apply again.'
  }),
  internalError: () => ({
    message: 'An unexpected error occurred while processing the preview.',
    recoveryAction: 'Try again; if the problem persists, check the server logs for details.'
  })
};

/** Build a typed, safe failure reason for a known code. */
export function buildPreviewFailure(
  code: SyncPreviewFailureCode,
  arrType?: SyncPreviewArrType
): SyncPreviewFailureReason {
  const { message, recoveryAction } = FAILURE_COPY[code](arrLabel(arrType));
  return { code, message, recoveryAction };
}

/** Map an `HttpError`'s numeric status to a closed failure code (never substring-based). */
function classifyHttpErrorStatus(status: number): SyncPreviewFailureCode {
  if (status === 0) {
    return 'unreachable';
  }
  if (status === 408) {
    return 'timeout';
  }
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 404) {
    return 'notFound';
  }
  if (status >= 500) {
    return 'serverError';
  }
  if (status >= 400) {
    return 'rejected';
  }
  return 'internalError';
}

/**
 * Classify an unknown thrown error into a typed, safe failure reason.
 *
 * Anchored on error TYPE/status only:
 * - `HttpError` → its numeric `.status` maps to an Arr-transport code.
 * - `AbortError` / `TimeoutError` (by `error.name`) → `timeout`.
 * - anything else → `internalError` (no raw message is ever inspected or transported).
 */
export function classifyPreviewFailure(error: unknown, arrType?: SyncPreviewArrType): SyncPreviewFailureReason {
  if (error instanceof HttpError) {
    return buildPreviewFailure(classifyHttpErrorStatus(error.status), arrType);
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return buildPreviewFailure('timeout', arrType);
  }

  return buildPreviewFailure('internalError', arrType);
}
