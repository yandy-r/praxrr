import type { Notifier } from '../../base/Notifier.ts';
import { postJson } from '../../base/delivery.ts';
import { renderText, resolveSeverity } from '../../content.ts';
import type { DeliveryOptions, DeliveryResult, Notification, NotificationSeverity } from '../../types.ts';
import { assertSafeDeliveryUrl } from '../validation.ts';
import type { AppriseConfig } from './provider.ts';

const APPRISE_TYPE: Record<NotificationSeverity, string> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'failure',
};

/**
 * Sends through an Apprise API server: stateful (`/notify/{config_key}`) or stateless (`/notify`
 * with `urls`).
 */
export class AppriseNotifier implements Notifier {
  constructor(
    private readonly config: AppriseConfig,
    private readonly secrets: readonly string[]
  ) {}

  getName(): string {
    return 'Apprise';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    assertSafeDeliveryUrl(this.config.server_url, 'Apprise API');

    const { title, message } = renderText(notification);
    const body: Record<string, string> = {
      title,
      // Apprise requires a non-empty body.
      body: message || title,
      type: APPRISE_TYPE[resolveSeverity(notification)],
    };
    if (this.config.tags) body.tag = this.config.tags;

    let url = `${this.config.server_url}/notify`;
    if (this.config.config_key) {
      url += `/${encodeURIComponent(this.config.config_key)}`;
    } else if (this.config.urls) {
      body.urls = this.config.urls;
    }

    return await postJson(url, body, { maxAttempts: options?.maxAttempts, secrets: this.secrets });
  }
}
