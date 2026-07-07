/** Sanitized failure reasons returned to the client; never leak raw error details. */
export type TestConnectionReason = 'unreachable' | 'unauthorized' | 'invalid_response' | 'timeout';

/**
 * Map an internal error to a sanitized reason string so response bodies never
 * echo raw error messages (which may include internal hostnames/paths).
 */
export function toFailureReason(error: unknown): TestConnectionReason {
  const message = error instanceof Error ? error.message : '';

  if (/timeout/i.test(message)) return 'timeout';
  if (/HTTP 401|HTTP 403/i.test(message)) return 'unauthorized';
  if (/HTTP \d/i.test(message)) return 'invalid_response';
  return 'unreachable';
}

/**
 * Map an HTTP status code from a failed connection attempt to a sanitized
 * reason string. `undefined` means the request never got an HTTP response
 * (network error, DNS failure, refused connection, etc).
 */
export function reasonFromStatus(status?: number): TestConnectionReason {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status !== undefined) return 'invalid_response';
  return 'unreachable';
}
