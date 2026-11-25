import { json } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';

/** Options for {@link internalErrorResponse}. */
export interface InternalErrorResponseOptions {
  /** Fixed, user-safe message returned to the client. Never derived from the thrown value. */
  message: string;
  /** Stable machine-readable code returned to the client. */
  code: string;
  /** Logger source tag. */
  source: string;
  /** Server-side log message; defaults to `message`. */
  logMessage?: string;
  /** Extra non-sensitive log context (ids, actions). */
  meta?: Record<string, unknown>;
  /** HTTP status; defaults to 500. Must be a 5xx status. */
  status?: number;
  /** Optional response headers. */
  headers?: HeadersInit;
}

/**
 * Log a server-side failure through the sanitizing logger and build a 5xx response that carries
 * only a fixed message and a stable code. Raw exception text (which can embed SQL, file paths or
 * upstream response bodies) stays in the server log and never reaches the client.
 */
export async function internalErrorResponse(error: unknown, options: InternalErrorResponseOptions): Promise<Response> {
  await logger.error(options.logMessage ?? options.message, {
    source: options.source,
    meta: { ...options.meta, error },
  });
  return json(
    { error: options.message, code: options.code },
    { status: options.status ?? 500, headers: options.headers }
  );
}
