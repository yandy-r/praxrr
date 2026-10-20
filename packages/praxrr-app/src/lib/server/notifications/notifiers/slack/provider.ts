import type { ProviderDefinition } from '../../registry.ts';
import { parseHttpUrl, readString, urlSecretValues } from '../validation.ts';
import { SlackNotifier } from './SlackNotifier.ts';

export interface SlackConfig {
  webhook_url: string;
}

function secretValues(config: SlackConfig): string[] {
  return urlSecretValues(config.webhook_url);
}

export const slackProvider: ProviderDefinition<SlackConfig> = {
  type: 'slack',
  validate(input) {
    const url = parseHttpUrl(readString(input, 'webhook_url'), 'Slack webhook');
    if (!url.ok) return url;
    return { ok: true, config: { webhook_url: url.url } };
  },
  create: (config) => new SlackNotifier(config, secretValues(config)),
  secretValues,
};
