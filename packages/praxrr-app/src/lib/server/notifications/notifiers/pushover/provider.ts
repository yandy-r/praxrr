import type { ProviderDefinition } from '../../registry.ts';
import { readString } from '../validation.ts';
import { PushoverNotifier } from './PushoverNotifier.ts';

export interface PushoverConfig {
  app_token: string;
  user_key: string;
  device?: string;
}

const KEY_PATTERN = /^[A-Za-z0-9]{30}$/;
const DEVICE_PATTERN = /^[A-Za-z0-9_-]{1,25}(,[A-Za-z0-9_-]{1,25})*$/;

function secretValues(config: PushoverConfig): string[] {
  return [config.app_token, config.user_key].filter(Boolean);
}

export const pushoverProvider: ProviderDefinition<PushoverConfig> = {
  type: 'pushover',
  validate(input) {
    const appToken = readString(input, 'app_token');
    if (!appToken) return { ok: false, error: 'Pushover API token is required' };
    if (!KEY_PATTERN.test(appToken)) {
      return { ok: false, error: 'Pushover API token must be 30 letters or digits' };
    }

    const userKey = readString(input, 'user_key');
    if (!userKey) return { ok: false, error: 'Pushover user key is required' };
    if (!KEY_PATTERN.test(userKey)) {
      return { ok: false, error: 'Pushover user key must be 30 letters or digits' };
    }

    const config: PushoverConfig = { app_token: appToken, user_key: userKey };
    const device = readString(input, 'device').replace(/\s+/g, '');
    if (device) {
      if (!DEVICE_PATTERN.test(device)) {
        return {
          ok: false,
          error: 'Pushover device must be comma-separated names of up to 25 letters, digits, "-" or "_"',
        };
      }
      config.device = device;
    }
    return { ok: true, config };
  },
  create: (config) => new PushoverNotifier(config, secretValues(config)),
  secretValues,
};
