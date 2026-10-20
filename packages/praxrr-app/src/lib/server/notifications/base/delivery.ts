/**
 * Shared notification delivery helper.
 *
 * Retries are applied per HTTP request (not per notification) so multi-request providers
 * (e.g. Discord sending one message per embed) never re-deliver chunks that already succeeded.
 */

import { HttpError } from '../../utils/http/types.ts';
import type { DeliveryResult } from '../types.ts';
import { getWebhookClient } from './webhookClient.ts';

export const MAX_ATTEMPTS = 3;
export const BASE_DELAY_MS = 1000;
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Delivery failure. `message` is already masked with the provider's secret values.
 */
export class NotificationDeliveryError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly status?: number
  ) {
    super(message);
    this.name = 'NotificationDeliveryError';
  }
}

/**
 * Timing seam; tests replace `sleep` to avoid real delays.
 */
export const deliveryTiming: { sleep(ms: number): Promise<void> } = {
  // Executor form: svelte-check's client lib target predates Promise.withResolvers (ES2024).
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/**
 * Network error/timeout (0), 408, 429 and any 5xx are worth retrying.
 */
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * Replace every non-empty secret (and its URL-encoded form) in `text` with '***'.
 */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    needles.add(secret);
    needles.add(encodeURIComponent(secret));
    needles.add(encodeURI(secret));
  }
  // Longest first so a secret containing another secret is masked whole.
  let masked = text;
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    masked = masked.split(needle).join('***');
  }
  return masked;
}

/**
 * Server-requested retry delay: `Retry-After` header, else Telegram's
 * `parameters.retry_after` (seconds) in the JSON error body.
 */
function getRetryAfterMs(error: HttpError): number | undefined {
  if (error.retryAfterMs !== undefined) return error.retryAfterMs;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('parameters' in response)) return undefined;
  const parameters = response.parameters;
  if (typeof parameters !== 'object' || parameters === null || !('retry_after' in parameters)) return undefined;
  const retryAfter = parameters.retry_after;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0
    ? retryAfter * 1000
    : undefined;
}

/**
 * POST a JSON body with bounded retry of transient failures.
 *
 * @returns the number of attempts used (1 = first-try success)
 * @throws {NotificationDeliveryError} with a secret-masked message on final failure
 */
export async function postJson(
  url: string,
  body: unknown,
  options: {
    headers?: Record<string, string>;
    maxAttempts?: number;
    secrets: readonly string[];
    /** Pre-serialized body sent verbatim (webhook HMAC signs exact bytes) */
    bodyText?: string;
  }
): Promise<DeliveryResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? MAX_ATTEMPTS));
  const payload = options.bodyText ?? body;

  for (let attempt = 1; ; attempt++) {
    try {
      await getWebhookClient().sendWebhook<unknown>(url, payload, options.headers);
      return { attempts: attempt };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 0;
      const message = error instanceof Error ? error.message : String(error);
      const fail = (reason?: string) =>
        new NotificationDeliveryError(
          maskSecrets(reason ? `${message} (${reason})` : message, options.secrets),
          attempt,
          status
        );

      if (!isTransientStatus(status) || attempt >= maxAttempts) {
        throw fail();
      }

      const retryAfterMs = error instanceof HttpError ? getRetryAfterMs(error) : undefined;
      if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) {
        throw fail(`retry-after ${Math.ceil(retryAfterMs / 1000)}s exceeds ${MAX_RETRY_AFTER_MS / 1000}s cap`);
      }

      await deliveryTiming.sleep(retryAfterMs ?? BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}
