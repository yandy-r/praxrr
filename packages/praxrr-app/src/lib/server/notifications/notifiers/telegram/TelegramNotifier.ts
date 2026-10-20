import type { Notifier } from '../../base/Notifier.ts';
import { postJson } from '../../base/delivery.ts';
import { renderText, truncate } from '../../content.ts';
import type { DeliveryOptions, DeliveryResult, Notification } from '../../types.ts';
import type { TelegramConfig } from './provider.ts';

const MAX_TEXT_LENGTH = 4096;

/**
 * Sends a plain-text message through the Telegram Bot API (`sendMessage`).
 * The bot token is part of the URL, so it must be masked from any error text.
 */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly config: TelegramConfig,
    private readonly secrets: readonly string[]
  ) {}

  getName(): string {
    return 'Telegram';
  }

  async notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult> {
    const { title, message } = renderText(notification);
    const body: Record<string, string | number | boolean> = {
      // Numeric ids are sent as numbers; @channelname stays a string.
      chat_id: this.config.chat_id.startsWith('@') ? this.config.chat_id : Number(this.config.chat_id),
      text: truncate(message ? `${title}\n\n${message}` : title, MAX_TEXT_LENGTH),
    };
    if (this.config.message_thread_id) body.message_thread_id = Number(this.config.message_thread_id);
    if (this.config.silent) body.disable_notification = true;

    return await postJson(`https://api.telegram.org/bot${this.config.bot_token}/sendMessage`, body, {
      maxAttempts: options?.maxAttempts,
      secrets: this.secrets,
    });
  }
}
