/**
 * Shared HTTP client for webhook-based notifications
 * Uses BaseHttpClient for connection pooling
 */

import { BaseHttpClient } from '../../utils/http/client.ts';

/**
 * Webhook HTTP client
 * Extends BaseHttpClient with webhook-specific settings:
 * - No retries (the notification delivery helper owns retry policy)
 * - 10 second timeout
 */
class WebhookClient extends BaseHttpClient {
  constructor() {
    // Empty base URL - we pass full webhook URLs as paths
    super('', {
      timeout: 10000,
      retries: 0,
    });
  }

  /**
   * POST to a webhook URL.
   * A string `payload` is sent verbatim as the JSON body (pre-serialized, e.g. for HMAC signing);
   * any other value is JSON-serialized.
   */
  sendWebhook<T = void>(url: string, payload: unknown, headers?: Record<string, string>): Promise<T> {
    if (typeof payload === 'string') {
      return this.request<T>('POST', url, { headers, bodyText: payload });
    }
    return this.post<T>(url, payload, { headers });
  }
}

// Singleton instance - lazy initialized
let webhookClient: WebhookClient | null = null;

/**
 * Get the shared webhook client
 */
export function getWebhookClient(): WebhookClient {
  if (!webhookClient) {
    webhookClient = new WebhookClient();
  }
  return webhookClient;
}
