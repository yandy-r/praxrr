import { logger } from '$logger/logger.ts';
import type { DiscordConfig, Notification } from '../../types.ts';
import { Colors, type DiscordEmbed } from './embed.ts';
import { getWebhookClient } from '../../base/webhookClient.ts';

const RATE_LIMIT_DELAY = 1000; // 1 second between messages

/**
 * Calculate Discord's character count for an embed
 * Only counts: title, description, author.name, footer.text, field names/values
 */
function getEmbedCharCount(embed: DiscordEmbed): number {
  let size = 0;
  if (embed.author?.name) size += embed.author.name.length;
  if (embed.title) size += embed.title.length;
  if (embed.description) size += embed.description.length;
  if (embed.footer?.text) size += embed.footer.text.length;
  if (embed.fields) {
    for (const field of embed.fields) {
      size += field.name.length + field.value.length;
    }
  }
  return size;
}

/**
 * Discord notification service implementation
 * Handles splitting large notifications across multiple messages
 */
export class DiscordNotifier {
  constructor(private config: DiscordConfig) {}

  getName(): string {
    return 'Discord';
  }

  /**
   * Send notification, splitting into multiple messages if needed
   */
  async notify(notification: Notification): Promise<void> {
    const allEmbeds = this.getEmbeds(notification);
    const chunks = this.chunkEmbeds(allEmbeds);

    for (let i = 0; i < chunks.length; i++) {
      // Rate limit between messages
      if (i > 0) {
        await this.sleep(RATE_LIMIT_DELAY);
      }

      const payload = {
        username: this.config.username || 'Praxrr',
        avatar_url: this.config.avatar_url,
        content: i === 0 && this.config.enable_mentions ? '@here' : undefined,
        embeds: chunks[i],
      };

      await this.sendWebhook(payload);
    }
  }

  /**
   * Extract embeds from notification
   */
  private getEmbeds(notification: Notification): DiscordEmbed[] {
    // Use Discord-specific embeds if provided
    if (notification.discord?.embeds && notification.discord.embeds.length > 0) {
      return notification.discord.embeds;
    }

    // Fall back to generic content
    if (notification.generic) {
      const color = this.getColorForType(notification.type);
      return [
        {
          title: notification.generic.title,
          description: notification.generic.message,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: 'Praxrr' },
        },
      ];
    }

    // Empty notification
    return [
      {
        title: 'Notification',
        description: 'No content provided',
        color: Colors.INFO,
        timestamp: new Date().toISOString(),
        footer: { text: 'Praxrr' },
      },
    ];
  }

  /**
   * Split embeds into 1 per message
   */
  private chunkEmbeds(embeds: DiscordEmbed[]): DiscordEmbed[][] {
    return embeds.map((embed) => [embed]);
  }

  /**
   * Send a single webhook request
   */
  private async sendWebhook(payload: unknown): Promise<void> {
    const payloadObj = payload as { embeds?: unknown[] };

    try {
      await getWebhookClient().sendWebhook(this.config.webhook_url, payload);
    } catch (error) {
      const embedCharCounts =
        payloadObj.embeds?.map((e, i) => `${i}:${getEmbedCharCount(e as DiscordEmbed)}`).join(', ') || 'none';
      await logger.error('Failed to send notification', {
        source: this.getName(),
        meta: {
          error: error instanceof Error ? error.message : String(error),
          embedCharCounts,
        },
      });
      throw error;
    }
  }

  /**
   * Determine embed color based on notification type
   */
  private getColorForType(type: string): number {
    const lowerType = type.toLowerCase();

    if (lowerType.includes('success')) {
      return Colors.SUCCESS;
    }
    if (lowerType.includes('failed') || lowerType.includes('error')) {
      return Colors.ERROR;
    }
    if (lowerType.includes('warning') || lowerType.includes('warn') || lowerType.includes('partial')) {
      return Colors.WARNING;
    }

    return Colors.INFO;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
