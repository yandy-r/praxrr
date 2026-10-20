/**
 * Discord provider definition (config validation, notifier factory, secret listing)
 */

import type { DiscordConfig } from '../../types.ts';
import type { ProviderDefinition } from '../../registry.ts';
import { parseHttpUrl, readString, urlSecretValues } from '../validation.ts';
import { DiscordNotifier } from './DiscordNotifier.ts';

/** Discord rejects webhook usernames longer than 80 characters */
const MAX_USERNAME_LENGTH = 80;

export const discordProvider: ProviderDefinition<DiscordConfig> = {
  type: 'discord',

  validate(input) {
    const webhook = parseHttpUrl(readString(input, 'webhook_url'), 'Discord webhook');
    if (!webhook.ok) return webhook;

    const username = readString(input, 'username');
    if (username.length > MAX_USERNAME_LENGTH) {
      return { ok: false, error: `Username must be at most ${MAX_USERNAME_LENGTH} characters` };
    }

    const avatarUrl = readString(input, 'avatar_url');
    if (avatarUrl) {
      let parsed: URL | null = null;
      try {
        parsed = new URL(avatarUrl);
      } catch {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        return { ok: false, error: 'Avatar URL must be a valid http(s) URL' };
      }
    }

    return {
      ok: true,
      config: {
        webhook_url: webhook.url,
        ...(username && { username }),
        ...(avatarUrl && { avatar_url: avatarUrl }),
        enable_mentions: input.enable_mentions === true,
      },
    };
  },

  create(config) {
    return new DiscordNotifier(config);
  },

  secretValues(config) {
    return urlSecretValues(config.webhook_url);
  },
};
