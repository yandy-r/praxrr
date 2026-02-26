import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';
import { logger } from '$logger/logger.ts';

/**
 * Parse and validate a raw source ID string into a positive integer.
 *
 * @param raw - Raw string value from route params
 * @returns `{ value }` on success or `{ error }` with a message on failure
 */
export function parseSourceId(raw: string | undefined): { value: number } | { error: string } {
  if (!raw) {
    return { error: 'Missing source id' };
  }

  if (!/^\d+$/.test(raw)) {
    return { error: 'Invalid source id' };
  }

  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Invalid source id' };
  }

  return { value: id };
}

/**
 * Map a TRaSH Guide read error to an HTTP status code.
 *
 * @param error - The caught error value
 * @returns 404 for not-found errors, 500 for all others
 */
export function mapReadErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceNotFoundError) {
    return 404;
  }

  return 500;
}

/**
 * Extract a human-readable message from an unknown error value.
 *
 * @param error - The caught error value
 * @returns The error message string, or a generic fallback
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'TRaSH source request failed';
}

/**
 * Parse an optional payload field that must be a non-empty string when present.
 *
 * @param value - Raw payload value to validate
 * @param field - Field name used in error messages
 * @returns `{ value }` (possibly `undefined`) on success or `{ error }` on failure
 */
export function parseOptionalNonEmptyString(
  value: unknown,
  field: string
): { value: string | undefined } | { error: string } {
  if (value === undefined) {
    return { value: undefined };
  }

  if (typeof value !== 'string') {
    return { error: `${field} must be a string when provided` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${field} cannot be empty` };
  }

  return { value: trimmed };
}

/**
 * Validate that a repository URL uses http or https.
 *
 * @param value - URL string to validate
 * @returns `null` if valid, or an error message string if invalid
 */
export function validateRepositoryUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'repositoryUrl must be a valid URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'repositoryUrl must use http or https';
  }

  return null;
}

/**
 * Log a TRaSH Guide API route error at the error level.
 *
 * @param error - The caught error value
 * @param context - Human-readable description of where the error occurred
 */
export async function logTrashGuideRouteError(error: unknown, context: string): Promise<void> {
  await logger.error('TRaSH Guide API route error', {
    source: 'TRaSH Guide',
    meta: {
      context,
      error: error instanceof Error ? error.message : String(error),
    },
  });
}
