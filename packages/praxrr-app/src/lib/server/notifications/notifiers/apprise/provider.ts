import type { ProviderDefinition } from '../../registry.ts';
import { parseHttpUrl, readString, urlSecretValues } from '../validation.ts';
import { AppriseNotifier } from './AppriseNotifier.ts';

export interface AppriseConfig {
  server_url: string;
  /** Stateful mode: key of a configuration stored on the Apprise server. */
  config_key?: string;
  /** Stateless mode: Apprise notification URLs (comma/newline separated). Secret. */
  urls?: string;
  tags?: string;
}

/** Apprise API config keys: 1-128 chars of letters, digits, '-' or '_'. */
const CONFIG_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function secretValues(config: AppriseConfig): string[] {
  if (!config.urls) return [];
  // Mask the whole value and each individual URL in stored and normalized form
  // (errors may echo one of them).
  const parts = config.urls
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap(urlSecretValues);
  return [config.urls, ...parts];
}

export const appriseProvider: ProviderDefinition<AppriseConfig> = {
  type: 'apprise',
  validate(input) {
    const server = parseHttpUrl(readString(input, 'server_url'), 'Apprise API');
    if (!server.ok) return server;

    const configKey = readString(input, 'config_key');
    const urls = readString(input, 'urls');
    if (Boolean(configKey) === Boolean(urls)) {
      return { ok: false, error: 'Apprise requires exactly one of a configuration key or Apprise URLs' };
    }
    if (configKey && !CONFIG_KEY_PATTERN.test(configKey)) {
      return { ok: false, error: 'Apprise configuration key must be 1-128 letters, digits, "-" or "_"' };
    }

    const config: AppriseConfig = { server_url: server.url.replace(/\/+$/, '') };
    if (configKey) config.config_key = configKey;
    if (urls) config.urls = urls;
    const tags = readString(input, 'tags');
    if (tags) config.tags = tags;
    return { ok: true, config };
  },
  create: (config) => new AppriseNotifier(config, secretValues(config)),
  secretValues,
};
