import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';
import { logger } from '$logger/logger.ts';

/**
 * Parse and validate a TRaSH source ID parameter.
 *
 * @param {string | undefined} raw - Raw source id from route params.
 * @returns {{ value: number } | { error: string }} Parsed numeric id or an error object.
 * @throws {never} This helper returns error values instead of throwing.
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
 * Convert read path errors into route status codes.
 *
 * @param {unknown} error - Error thrown while reading TRaSH source data.
 * @returns {number} HTTP status code to use for the response.
 * @throws {never} This helper does not throw.
 */
export function mapReadErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceNotFoundError) {
    return 404;
  }

  return 500;
}

/**
 * Convert any TRaSH route error into a user-facing message.
 *
 * @param {unknown} error - Unknown thrown value.
 * @returns {string} Error message for API responses.
 * @throws {never} This helper does not throw.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'TRaSH source request failed';
}

/**
 * Parse an optional string field from request payloads.
 *
 * @param {unknown} value - Raw input value.
 * @param {string} field - Field name used in validation errors.
 * @returns {{ value: string | undefined } | { error: string }} Parsed value or validation error.
 * @throws {never} This helper does not throw.
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
 * Validate a TRaSH source repository URL.
 *
 * @param {string} value - URL string to validate.
 * @returns {string | null} Error message when invalid, otherwise null.
 * @throws {never} This helper does not throw.
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
 * Log route-level TRaSH errors with context.
 *
 * @param {unknown} error - Error thrown while handling route logic.
 * @param {string} context - Human-readable route context.
 * @returns {Promise<void>} Resolves when the log entry is written.
 * @throws {Error} May throw if the logger errors during write.
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
