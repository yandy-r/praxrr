import type { Notifier } from '../../base/Notifier.ts';
import { postJson } from '../../base/delivery.ts';
import { renderText } from '../../content.ts';
import type { DeliveryOptions, DeliveryResult, Notification } from '../../types.ts';
import { assertSafeDeliveryUrl } from '../validation.ts';
import type { SlackConfig } from './provider.ts';

/** Slack mrkdwn control characters must be HTML-escaped. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Posts to a Slack (or Slack-compatible, e.g. Mattermost) incoming webhook.
 */
export class SlackNotifier implements Notifier {
  constructor(
    private readonly config: SlackConfig,
    private readonly secrets: readonly string[]
  ) {}

  getName(): string {
    return 'Slack';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    assertSafeDeliveryUrl(this.config.webhook_url, 'Slack webhook');

    const { title, message } = renderText(notification);
    const heading = `*${escapeMrkdwn(title)}*`;
    const text = message ? `${heading}\n${escapeMrkdwn(message)}` : heading;
    return await postJson(
      this.config.webhook_url,
      { text },
      { maxAttempts: options?.maxAttempts, secrets: this.secrets }
    );
  }
}
