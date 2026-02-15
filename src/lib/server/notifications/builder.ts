/**
 * Fluent notification builder
 * Provides a chainable API for constructing and sending notifications
 */

import { notificationManager } from './NotificationManager.ts';
import type { Notification } from './types.ts';
import { EmbedBuilder, type DiscordEmbed } from './notifiers/discord/embed.ts';

// Re-export Discord embed utilities for convenience
export {
  EmbedBuilder,
  createEmbed,
  Colors,
  Icons,
  getInstanceIcon,
  type DiscordEmbed,
  type EmbedField,
  type EmbedAuthor,
  type EmbedFooter,
} from './notifiers/discord/embed.ts';

/**
 * Discord-specific builder for adding embeds
 */
class DiscordBuilder {
  private embeds: DiscordEmbed[] = [];

  /**
   * Add an embed
   * Accepts an EmbedBuilder instance or a raw DiscordEmbed object
   */
  embed(embed: EmbedBuilder | DiscordEmbed): this {
    const built = embed instanceof EmbedBuilder ? embed.build() : embed;
    this.embeds.push(built);
    return this;
  }

  /**
   * Get the built embeds array
   */
  build(): DiscordEmbed[] {
    return this.embeds;
  }
}

/**
 * Builder class for constructing notifications
 */
class NotificationBuilder {
  private data: Notification;

  constructor(type: string) {
    this.data = { type };
  }

  /**
   * Set generic notification content (works for all services)
   * Services without specific payload will use this
   */
  generic(title: string, message: string): this {
    this.data.generic = { title, message };
    return this;
  }

  /**
   * Set Discord-specific content
   * Discord will use this if present, otherwise falls back to generic
   *
   * @example
   * .discord(d => d
   *   .embed(createEmbed().title('Success').color(Colors.SUCCESS))
   *   .embed(createEmbed().title('Details').field('Count', '5'))
   * )
   */
  discord(builder: (d: DiscordBuilder) => DiscordBuilder): this {
    const discordBuilder = new DiscordBuilder();
    builder(discordBuilder);
    this.data.discord = { embeds: discordBuilder.build() };
    return this;
  }

  /**
   * Send the notification via the notification manager
   * Routes to all enabled services that have this notification type enabled
   */
  async send(): Promise<void> {
    await notificationManager.notify(this.data);
  }

  /**
   * Build and return the raw notification object
   * Use this when you need to send directly to a specific notifier
   * (e.g., test notifications that bypass the notification manager)
   */
  build(): Notification {
    return this.data;
  }
}

/**
 * Create a new notification builder
 *
 * @example
 * // Generic notification (works for all services)
 * await notify('pcd.linked')
 *   .generic('Database Linked', 'Database "MyDB" has been linked successfully')
 *   .send();
 *
 * @example
 * // Discord with rich embeds, generic fallback for others
 * await notify('rename.success')
 *   .generic('Rename Complete', '5 files renamed')
 *   .discord(d => d
 *     .embed(createEmbed()
 *       .title('Rename Complete')
 *       .field('Files', '5/5', true)
 *       .field('Mode', 'Live', true)
 *       .color(Colors.SUCCESS)
 *       .timestamp()
 *       .footer('Profilarr')
 *     )
 *   )
 *   .send();
 */
export function notify(type: string): NotificationBuilder {
  return new NotificationBuilder(type);
}
