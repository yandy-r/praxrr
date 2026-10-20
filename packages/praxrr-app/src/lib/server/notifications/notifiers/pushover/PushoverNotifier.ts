import type { Notifier } from '../../base/Notifier.ts';
import { postJson } from '../../base/delivery.ts';
import { renderText, resolveSeverity, truncate } from '../../content.ts';
import type { DeliveryOptions, DeliveryResult, Notification } from '../../types.ts';
import type { PushoverConfig } from './provider.ts';

export const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json';
const MAX_TITLE_LENGTH = 250;
const MAX_MESSAGE_LENGTH = 1024;

/**
 * Sends a message through the Pushover messages API.
 */
export class PushoverNotifier implements Notifier {
  constructor(
    private readonly config: PushoverConfig,
    private readonly secrets: readonly string[]
  ) {}

  getName(): string {
    return 'Pushover';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    const { title, message } = renderText(notification);
    const body: Record<string, string | number> = {
      token: this.config.app_token,
      user: this.config.user_key,
      title: truncate(title, MAX_TITLE_LENGTH),
      // Pushover rejects an empty message.
      message: truncate(message || title, MAX_MESSAGE_LENGTH),
      priority: resolveSeverity(notification) === 'error' ? 1 : 0,
    };
    if (this.config.device) body.device = this.config.device;

    return await postJson(PUSHOVER_API_URL, body, { maxAttempts: options?.maxAttempts, secrets: this.secrets });
  }
}
