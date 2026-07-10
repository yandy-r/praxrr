/**
 * Canary coordinator typed errors
 * The coordinator throws these so API routes can map control-flow failures to HTTP
 * status codes without string-sniffing: unresolved -> 422, not-found -> 404,
 * wrong-state -> 409, preview-unavailable -> 409, stale-token -> 422. Mirrors
 * the `utils/git/errors.ts` idiom (named subclass + `is*` predicate) rather
 * than ad-hoc `Error` instances.
 */

import type { SyncPreviewFailureReason } from '$sync/preview/types.ts';

/** No canary is resolvable, or the requested scope is not a supported `arr_type` (-> 422). */
export class CanaryUnresolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanaryUnresolvedError';
  }
}

/** The referenced rollout does not exist (-> 404). */
export class CanaryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanaryNotFoundError';
  }
}

/** The rollout is not in the status this transition requires (-> 409). */
export class CanaryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanaryStateError';
  }
}

/** Remaining-target evidence is unavailable or invalid, so promotion is blocked (-> 409). */
export class CanaryPreviewUnavailableError extends Error {
  constructor(readonly failure: SyncPreviewFailureReason) {
    super(failure.message);
    this.name = 'CanaryPreviewUnavailableError';
  }
}

/** The caller's `state_token` no longer matches the live rollout (-> 422). */
export class CanaryStaleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanaryStaleTokenError';
  }
}

export function isCanaryUnresolvedError(input: unknown): input is CanaryUnresolvedError {
  return input instanceof Error && input.name === 'CanaryUnresolvedError';
}

export function isCanaryNotFoundError(input: unknown): input is CanaryNotFoundError {
  return input instanceof Error && input.name === 'CanaryNotFoundError';
}

export function isCanaryStateError(input: unknown): input is CanaryStateError {
  return input instanceof Error && input.name === 'CanaryStateError';
}

export function isCanaryPreviewUnavailableError(input: unknown): input is CanaryPreviewUnavailableError {
  return input instanceof Error && input.name === 'CanaryPreviewUnavailableError';
}

export function isCanaryStaleTokenError(input: unknown): input is CanaryStaleTokenError {
  return input instanceof Error && input.name === 'CanaryStaleTokenError';
}
