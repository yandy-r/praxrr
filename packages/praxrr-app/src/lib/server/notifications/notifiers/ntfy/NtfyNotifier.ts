import type { Notifier } from '../../base/Notifier.ts';
import { postJson } from '../../base/delivery.ts';
import { renderText, resolveSeverity } from '../../content.ts';
import type { DeliveryOptions, DeliveryResult, Notification, NotificationSeverity } from '../../types.ts';
import { assertSafeDeliveryUrl } from '../validation.ts';
import type { NtfyConfig } from './provider.ts';

/** ntfy priorities: 1 min … 5 max; 3 is default. */
const PRIORITY: Record<NotificationSeverity, number> = { error: 4, warning: 3, success: 3, info: 3 };
const TAG: Record<NotificationSeverity, string> = {
  error: 'rotating_light',
  warning: 'warning',
  success: 'white_check_mark',
  info: 'information_source',
};

/** Base64 `username:password` for HTTP Basic auth (UTF-8 safe). */
export function encodeBasicCredential(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Publishes to an ntfy server using the JSON publish API (POST to the server root).
 */
export class NtfyNotifier implements Notifier {
  constructor(
    private readonly config: NtfyConfig,
    private readonly secrets: readonly string[]
  ) {}

  getName(): string {
    return 'ntfy';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    assertSafeDeliveryUrl(this.config.server_url, 'ntfy server');

    const { title, message } = renderText(notification);
    const severity = resolveSeverity(notification);
    const headers: Record<string, string> = {};
    if (this.config.access_token) {
      headers.Authorization = `Bearer ${this.config.access_token}`;
    } else if (this.config.username && this.config.password) {
      headers.Authorization = `Basic ${encodeBasicCredential(this.config.username, this.config.password)}`;
    }

    return await postJson(
      this.config.server_url,
      { topic: this.config.topic, title, message, priority: PRIORITY[severity], tags: [TAG[severity]] },
      { headers, maxAttempts: options?.maxAttempts, secrets: this.secrets }
    );
  }
}
