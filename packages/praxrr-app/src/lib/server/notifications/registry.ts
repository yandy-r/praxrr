/**
 * Notification provider registry.
 *
 * The single place that maps a stored `service_type` to its validation, notifier factory and
 * secret listing. Field descriptors (form shape, which keys are secret) come from the client-safe
 * `$shared/notifications/providers.ts`.
 */

import { getProviderDescriptor, type NotificationProviderType } from '$shared/notifications/providers.ts';
import type { Notifier } from './base/Notifier.ts';
import { discordProvider } from './notifiers/discord/provider.ts';
import { webhookProvider } from './notifiers/webhook/provider.ts';
import { ntfyProvider } from './notifiers/ntfy/provider.ts';
import { gotifyProvider } from './notifiers/gotify/provider.ts';
import { pushoverProvider } from './notifiers/pushover/provider.ts';
import { telegramProvider } from './notifiers/telegram/provider.ts';
import { slackProvider } from './notifiers/slack/provider.ts';
import { appriseProvider } from './notifiers/apprise/provider.ts';

export type ProviderFormInput = Record<string, string | boolean>;
export type ParseResult<C> = { ok: true; config: C } | { ok: false; error: string };

export interface ProviderDefinition<C = Record<string, unknown>> {
  type: NotificationProviderType;
  /** Input is already merged with kept (unchanged) secret values */
  validate(input: ProviderFormInput): ParseResult<C>;
  create(config: C): Notifier;
  /** Every secret string in the config (incl. custom header values and URLs embedding tokens) */
  secretValues(config: C): string[];
}

/**
 * Erase a provider's concrete config type for heterogeneous storage. Sound because every config
 * reaching a provider through this registry was produced by that provider's own `validate`.
 */
function erase<C>(provider: ProviderDefinition<C>): ProviderDefinition {
  return provider as unknown as ProviderDefinition;
}

const providers: Record<NotificationProviderType, ProviderDefinition> = {
  discord: erase(discordProvider),
  webhook: erase(webhookProvider),
  ntfy: erase(ntfyProvider),
  gotify: erase(gotifyProvider),
  pushover: erase(pushoverProvider),
  telegram: erase(telegramProvider),
  slack: erase(slackProvider),
  apprise: erase(appriseProvider),
};

export function getProvider(type: string): ProviderDefinition | undefined {
  return Object.hasOwn(providers, type) ? providers[type as NotificationProviderType] : undefined;
}

/**
 * Read a provider's descriptor fields from submitted form data and validate them.
 * Blank secret fields keep the value from `existingConfig` (edit flow), unless the field is
 * optional and `<key>__clear=on` was submitted, in which case the stored value is dropped.
 */
export function parseProviderForm(
  type: string,
  form: FormData,
  existingConfig?: Record<string, unknown>
): ParseResult<Record<string, unknown>> {
  const provider = getProvider(type);
  const descriptor = getProviderDescriptor(type);
  if (!provider || !descriptor) {
    return { ok: false, error: 'Unknown notification service type' };
  }

  const input: ProviderFormInput = {};
  for (const field of descriptor.fields) {
    if (field.kind === 'checkbox') {
      input[field.key] = form.get(field.key) === 'on';
      continue;
    }
    const raw = form.get(field.key);
    const value = typeof raw === 'string' ? raw.trim() : '';
    const existing = existingConfig?.[field.key];
    const cleared = field.secret && !field.required && form.get(`${field.key}__clear`) === 'on';
    input[field.key] = value === '' && field.secret && !cleared && typeof existing === 'string' ? existing : value;
  }

  return provider.validate(input);
}

/**
 * Strip secret fields before a config is sent to the browser; `secretsSet` lists the secret keys
 * that currently hold a value.
 */
export function toClientConfig(
  type: string,
  config: Record<string, unknown>
): { config: Record<string, unknown>; secretsSet: string[] } {
  const descriptor = getProviderDescriptor(type);
  const secretKeys = (descriptor?.fields ?? []).filter((field) => field.secret).map((field) => field.key);

  const clientConfig: Record<string, unknown> = { ...config };
  const secretsSet: string[] = [];
  for (const key of secretKeys) {
    const value = clientConfig[key];
    if (value !== undefined && value !== null && value !== '') {
      secretsSet.push(key);
    }
    delete clientConfig[key];
  }

  return { config: clientConfig, secretsSet };
}
