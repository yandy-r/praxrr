import type { Notifier } from '../../base/Notifier.ts';
import { NotificationDeliveryError, postJson } from '../../base/delivery.ts';
import type { DeliveryOptions, DeliveryResult, Notification } from '../../types.ts';
import { assertSafeDeliveryUrl } from '../validation.ts';
import { buildWebhookPayload } from './payload.ts';
import { parseCustomHeaders, signWebhookBody } from './signature.ts';
import type { WebhookConfig } from './provider.ts';

/**
 * Generic JSON webhook: POSTs the versioned payload, optionally HMAC-signed, with custom headers.
 */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly config: WebhookConfig,
    private readonly secrets: readonly string[]
  ) {}

  getName(): string {
    return 'Webhook';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    assertSafeDeliveryUrl(this.config.url, 'Webhook');

    const parsedHeaders = parseCustomHeaders(this.config.headers ?? '');
    if (!parsedHeaders.ok) throw new NotificationDeliveryError(parsedHeaders.error, 0);

    const payload = buildWebhookPayload(notification);
    // Serialize once: the signature must cover the exact bytes sent on the wire.
    const bodyText = JSON.stringify(payload);

    const headers: Record<string, string> = { ...parsedHeaders.headers, 'X-Praxrr-Event': notification.type };
    if (this.config.secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers['X-Praxrr-Timestamp'] = timestamp;
      headers['X-Praxrr-Signature'] = await signWebhookBody(this.config.secret, timestamp, bodyText);
    }

    return await postJson(this.config.url, payload, {
      headers,
      bodyText,
      maxAttempts: options?.maxAttempts,
      secrets: this.secrets,
    });
  }
}
