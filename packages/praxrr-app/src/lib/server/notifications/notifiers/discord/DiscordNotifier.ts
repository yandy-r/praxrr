import type { DeliveryOptions, DeliveryResult, DiscordConfig, Notification } from '../../types.ts';
import type { Notifier } from '../../base/Notifier.ts';
import { deliveryTiming, NotificationDeliveryError, postJson } from '../../base/delivery.ts';
import { resolveSeverity } from '../../content.ts';
import { assertSafeDeliveryUrl, urlSecretValues } from '../validation.ts';
import { Colors, type DiscordEmbed } from './embed.ts';

const RATE_LIMIT_DELAY = 1000; // 1 second between messages

const SEVERITY_COLORS = {
  info: Colors.INFO,
  success: Colors.SUCCESS,
  warning: Colors.WARNING,
  error: Colors.ERROR,
} as const;

/**
 * Discord notification service implementation
 * Sends one message per embed; each message is retried independently by `postJson`.
 */
export class DiscordNotifier implements Notifier {
  constructor(private config: DiscordConfig) {}

  getName(): string {
    return 'Discord';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    assertSafeDeliveryUrl(this.config.webhook_url, 'Discord webhook');

    const username = this.config.username || 'Praxrr';
    const embeds = this.getEmbeds(notification).map((embed) =>
      embed.author ? embed : { ...embed, author: { name: username, icon_url: this.config.avatar_url || undefined } }
    );

    const secrets = urlSecretValues(this.config.webhook_url);
    let attempts = 0;
    for (let i = 0; i < embeds.length; i++) {
      if (i > 0) {
        await deliveryTiming.sleep(RATE_LIMIT_DELAY);
      }

      const payload = {
        username,
        avatar_url: this.config.avatar_url || undefined,
        content: i === 0 && this.config.enable_mentions ? '@here' : undefined,
        embeds: [embeds[i]],
      };

      try {
        const result = await postJson(this.config.webhook_url, payload, {
          maxAttempts: options?.maxAttempts,
          secrets,
        });
        attempts = Math.max(attempts, result.attempts);
      } catch (error) {
        // Report the worst chunk's attempt count, including chunks that eventually succeeded.
        if (error instanceof NotificationDeliveryError) {
          throw new NotificationDeliveryError(error.message, Math.max(attempts, error.attempts), error.status);
        }
        throw error;
      }
    }

    return { attempts };
  }

  /**
   * Discord-specific embeds if provided, else one embed built from the generic content
   */
  private getEmbeds(notification: Notification): DiscordEmbed[] {
    if (notification.discord?.embeds && notification.discord.embeds.length > 0) {
      return notification.discord.embeds;
    }

    return [
      {
        title: notification.generic?.title ?? 'Notification',
        description: notification.generic?.message ?? 'No content provided',
        color: SEVERITY_COLORS[resolveSeverity(notification)],
        timestamp: notification.occurredAt ?? new Date().toISOString(),
        footer: { text: 'Praxrr' },
      },
    ];
  }
}
