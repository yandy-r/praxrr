import type { ProviderDefinition } from '../../registry.ts';
import { parseHttpUrl, readString } from '../validation.ts';
import { GotifyNotifier } from './GotifyNotifier.ts';

export interface GotifyConfig {
  server_url: string;
  app_token: string;
}

function secretValues(config: GotifyConfig): string[] {
  return [config.app_token].filter(Boolean);
}

export const gotifyProvider: ProviderDefinition<GotifyConfig> = {
  type: 'gotify',
  validate(input) {
    const server = parseHttpUrl(readString(input, 'server_url'), 'Gotify server');
    if (!server.ok) return server;

    const appToken = readString(input, 'app_token');
    if (!appToken) return { ok: false, error: 'Gotify application token is required' };

    return { ok: true, config: { server_url: server.url.replace(/\/+$/, ''), app_token: appToken } };
  },
  create: (config) => new GotifyNotifier(config, secretValues(config)),
  secretValues,
};
