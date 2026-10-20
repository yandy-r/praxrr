/**
 * HTTP Client Types
 */

export interface HttpClientOptions {
  timeout?: number; // Request timeout in milliseconds (default: 30000)
  headers?: Record<string, string>; // Default headers to include in all requests
  retries?: number; // Number of retries (default: 3)
  retryDelay?: number; // Initial retry delay in ms (default: 500)
  retryStatusCodes?: number[]; // Status codes to retry on (default: [500, 502, 503, 504])
  poolMaxIdlePerHost?: number; // Max idle connections per host (default: 5)
  poolIdleTimeout?: number; // Idle connection timeout in ms (default: 30000)
}

export interface RequestOptions {
  headers?: Record<string, string>; // Additional headers for this request
  timeout?: number; // Override timeout for this request
  signal?: AbortSignal; // Abort signal for cancellation
  responseType?: 'json' | 'text'; // Response parsing type (default: 'json')
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown,
    /** Delay requested by the server via the `Retry-After` header, in milliseconds */
    public retryAfterMs?: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Parse a `Retry-After` header value (delta-seconds or HTTP-date) into milliseconds.
 * Returns undefined when absent or unparseable; past dates clamp to 0.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}
