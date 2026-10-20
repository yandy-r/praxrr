import type { ProviderDefinition } from '../../registry.ts';
import { readString } from '../validation.ts';
import { TelegramNotifier } from './TelegramNotifier.ts';

export interface TelegramConfig {
  bot_token: string;
  /** Signed integer chat id or `@channelname`. */
  chat_id: string;
  message_thread_id?: string;
  silent?: boolean;
}

const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;
/** Telegram usernames: 5-32 chars, letter first, letters/digits/underscore. */
const CHAT_ID_PATTERN = /^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const THREAD_ID_PATTERN = /^[1-9]\d*$/;

function secretValues(config: TelegramConfig): string[] {
  return [config.bot_token].filter(Boolean);
}

export const telegramProvider: ProviderDefinition<TelegramConfig> = {
  type: 'telegram',
  validate(input) {
    const botToken = readString(input, 'bot_token');
    if (!botToken) return { ok: false, error: 'Telegram bot token is required' };
    if (!BOT_TOKEN_PATTERN.test(botToken)) {
      return { ok: false, error: 'Telegram bot token must look like "123456789:AA…" (from @BotFather)' };
    }

    const chatId = readString(input, 'chat_id');
    if (!chatId) return { ok: false, error: 'Telegram chat ID is required' };
    if (!CHAT_ID_PATTERN.test(chatId)) {
      return { ok: false, error: 'Telegram chat ID must be a number (e.g. -1001234567890) or @channelname' };
    }

    const config: TelegramConfig = { bot_token: botToken, chat_id: chatId };
    const threadId = readString(input, 'message_thread_id');
    if (threadId) {
      if (!THREAD_ID_PATTERN.test(threadId)) {
        return { ok: false, error: 'Telegram topic (thread) ID must be a positive integer' };
      }
      config.message_thread_id = threadId;
    }
    if (input.silent === true) config.silent = true;
    return { ok: true, config };
  },
  create: (config) => new TelegramNotifier(config, secretValues(config)),
  secretValues,
};
