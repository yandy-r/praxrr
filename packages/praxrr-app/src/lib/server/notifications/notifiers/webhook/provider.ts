import type { ProviderDefinition } from '../../registry.ts';
import { parseHttpUrl, readString, urlSecretValues } from '../validation.ts';
import { parseCustomHeaders } from './signature.ts';
import { WebhookNotifier } from './WebhookNotifier.ts';

export interface WebhookConfig {
  url: string;
  secret?: string;
  /** Raw `Name: value` lines; values are secrets. */
  headers?: string;
}

function secretValues(config: WebhookConfig): string[] {
  const secrets = urlSecretValues(config.url);
  if (config.secret) secrets.push(config.secret);
  const parsed = parseCustomHeaders(config.headers ?? '');
  if (parsed.ok) secrets.push(...Object.values(parsed.headers));
  return secrets.filter(Boolean);
}

export const webhookProvider: ProviderDefinition<WebhookConfig> = {
  type: 'webhook',
  validate(input) {
    const url = parseHttpUrl(readString(input, 'url'), 'Webhook');
    if (!url.ok) return url;

    const headersText = readString(input, 'headers');
    const headers = parseCustomHeaders(headersText);
    if (!headers.ok) return headers;

    const config: WebhookConfig = { url: url.url };
    const secret = readString(input, 'secret');
    if (secret) config.secret = secret;
    if (headersText) config.headers = headersText;
    return { ok: true, config };
  },
  create: (config) => new WebhookNotifier(config, secretValues(config)),
  secretValues,
};
