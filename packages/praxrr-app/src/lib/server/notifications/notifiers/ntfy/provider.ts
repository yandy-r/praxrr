import type { ProviderDefinition } from '../../registry.ts';
import { parseHttpUrl, readString } from '../validation.ts';
import { encodeBasicCredential, NtfyNotifier } from './NtfyNotifier.ts';

export interface NtfyConfig {
  server_url: string;
  topic: string;
  access_token?: string;
  username?: string;
  password?: string;
}

const DEFAULT_SERVER_URL = 'https://ntfy.sh';
const TOPIC_PATTERN = /^[-_A-Za-z0-9]{1,64}$/;

function secretValues(config: NtfyConfig): string[] {
  const secrets = [config.access_token, config.password].filter((value): value is string => Boolean(value));
  if (config.username && config.password) {
    // The Basic credential is derived from the password; mask its encoded form too.
    secrets.push(encodeBasicCredential(config.username, config.password));
  }
  return secrets;
}

export const ntfyProvider: ProviderDefinition<NtfyConfig> = {
  type: 'ntfy',
  validate(input) {
    const server = parseHttpUrl(readString(input, 'server_url') || DEFAULT_SERVER_URL, 'ntfy server');
    if (!server.ok) return server;

    const topic = readString(input, 'topic');
    if (!topic) return { ok: false, error: 'ntfy topic is required' };
    if (!TOPIC_PATTERN.test(topic)) {
      return { ok: false, error: 'ntfy topic must be 1-64 letters, digits, "-" or "_"' };
    }

    const username = readString(input, 'username');
    const password = readString(input, 'password');
    if (Boolean(username) !== Boolean(password)) {
      return { ok: false, error: 'ntfy username and password must be set together' };
    }

    const config: NtfyConfig = { server_url: server.url.replace(/\/+$/, ''), topic };
    const accessToken = readString(input, 'access_token');
    if (accessToken) config.access_token = accessToken;
    if (username) config.username = username;
    if (password) config.password = password;
    return { ok: true, config };
  },
  create: (config) => new NtfyNotifier(config, secretValues(config)),
  secretValues,
};
