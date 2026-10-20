import type { Notifier } from '../../base/Notifier.ts';
import { postJson } from '../../base/delivery.ts';
import { renderText, resolveSeverity } from '../../content.ts';
import type { DeliveryOptions, DeliveryResult, Notification, NotificationSeverity } from '../../types.ts';
import { assertSafeDeliveryUrl } from '../validation.ts';
import type { GotifyConfig } from './provider.ts';

/** Gotify priorities 0-10; clients typically alert at >= 4 and pop up at >= 8. */
const PRIORITY: Record<NotificationSeverity, number> = { error: 8, warning: 5, success: 2, info: 2 };

/**
 * Posts to a Gotify server's message API with an application token.
 */
export class GotifyNotifier implements Notifier {
  constructor(
    private readonly config: GotifyConfig,
    private readonly secrets: readonly string[]
  ) {}

  getName(): string {
    return 'Gotify';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    assertSafeDeliveryUrl(this.config.server_url, 'Gotify server');

    const { title, message } = renderText(notification);
    return await postJson(
      `${this.config.server_url}/message`,
      { title, message, priority: PRIORITY[resolveSeverity(notification)] },
      {
        headers: { 'X-Gotify-Key': this.config.app_token },
        maxAttempts: options?.maxAttempts,
        secrets: this.secrets,
      }
    );
  }
}
