import { config } from '$config';
import { createArrClient } from '$arr/factory.ts';
import { logger } from '$logger/logger.ts';
import { parseOptionalAbsoluteHttpUrl } from '$utils/validation/url.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { ARR_APP_TYPES, type ArrAppType } from '$shared/pcd/types.ts';
import {
  deriveArrInstanceApiKeyFingerprint,
  encryptArrInstanceApiKey,
} from '$server/utils/encryption/arr-credentials.ts';

const APP_TYPE_KEYS = ARR_APP_TYPES;
const APP_LABELS: Record<ArrAppType, string> = {
  radarr: 'Radarr',
  sonarr: 'Sonarr',
  lidarr: 'Lidarr',
};

const APP_INSTANCE_ENV_KEY_RE = /^([A-Z]+)_INSTANCE_(URL|API_KEY|NAME|EXTERNAL_URL|TAGS|ENABLED)_(\d+)$/;

interface ParsedEnvInstanceRaw {
  index: number;
  type: ArrAppType;
  url?: string;
  apiKey?: string;
  name?: string;
  externalUrl?: string;
  tags?: string;
  enabled?: string;
}

/**
 * Parsed descriptor used by env reconciliation.
 */
export interface ParsedEnvInstanceDescriptor {
  type: ArrAppType;
  index: number;
  url: string;
  apiKey: string;
  name: string;
  externalUrl: string | null;
  tags: string[];
  enabled: boolean;
}

export interface ReconcileEnvInstancesResult {
  created: number;
  updated: number;
  disabled: number;
  skippedConflictUi: number;
  skippedDuplicateEnvKey: number;
  validationSuccesses: number;
  validationFailures: number;
  errors: number;
}

const ARR_TEST_TIMEOUT_MS = 3000;
const ARR_TEST_RETRIES = 0;
function isSupportedArrAppType(value: string): value is ArrAppType {
  return (APP_TYPE_KEYS as readonly string[]).includes(value);
}

function isSupportedArrAppTypePrefix(value: string): value is ArrAppType {
  return isSupportedArrAppType(value);
}

/**
 * Coerce optional `enabled` values from env variables. Defaults to `true`.
 */
export function parseEnabledFromEnv(value?: string | null): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  return true;
}

/**
 * Coerce optional comma-separated tags into a deterministic string list.
 */
export function parseTagsFromEnv(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Coerce optional external URL and clear invalid/empty values to NULL.
 */
export function parseExternalUrlFromEnv(value?: string | null): string | null {
  const parsed = parseOptionalAbsoluteHttpUrl(value?.trim());
  if (!parsed.isValid) {
    return null;
  }

  return parsed.value;
}

async function validateInstanceConnection(descriptor: ParsedEnvInstanceDescriptor): Promise<boolean> {
  const client = createArrClient(descriptor.type, descriptor.url, descriptor.apiKey, {
    timeout: ARR_TEST_TIMEOUT_MS,
    retries: ARR_TEST_RETRIES,
  });

  try {
    return await client.testConnection();
  } finally {
    client.close();
  }
}

/**
 * Parse app-prefixed env groups into reconciliation-ready descriptors.
 * Supported names:
 *   RADARR_INSTANCE_URL_<N>
 *   RADARR_INSTANCE_API_KEY_<N>
 *   RADARR_INSTANCE_NAME_<N>
 *   RADARR_INSTANCE_EXTERNAL_URL_<N>
 *   RADARR_INSTANCE_TAGS_<N>
 *   RADARR_INSTANCE_ENABLED_<N>
 *
 * where app is RADARR | SONARR | LIDARR and N is a positive integer.
 */
export function parseArrInstanceEnvVars(): ParsedEnvInstanceDescriptor[] {
  const grouped: Map<ArrAppType, Map<number, ParsedEnvInstanceRaw>> = new Map(
    APP_TYPE_KEYS.map((type) => [type, new Map<number, ParsedEnvInstanceRaw>()])
  );

  const entries = Object.entries(Deno.env.toObject()).sort((left, right) => left[0].localeCompare(right[0]));

  for (const [rawKey, rawValue] of entries) {
    const match = rawKey.match(APP_INSTANCE_ENV_KEY_RE);
    if (!match) {
      continue;
    }

    const [, rawType, prop, rawIndex] = match;
    const loweredType = rawType.toLowerCase();
    if (!isSupportedArrAppTypePrefix(loweredType)) {
      throw new Error(`Unsupported arr app type in env var key: ${rawType}`);
    }

    const index = Number.parseInt(rawIndex, 10);
    if (Number.isNaN(index) || index < 1) {
      continue;
    }

    const byIndex = grouped.get(loweredType);
    if (!byIndex) {
      continue;
    }

    const existing = byIndex.get(index) ?? { index, type: loweredType };
    switch (prop) {
      case 'URL':
        existing.url = rawValue?.trim();
        break;
      case 'API_KEY':
        existing.apiKey = rawValue?.trim();
        break;
      case 'NAME':
        existing.name = rawValue?.trim();
        break;
      case 'EXTERNAL_URL':
        existing.externalUrl = rawValue?.trim();
        break;
      case 'TAGS':
        existing.tags = rawValue;
        break;
      case 'ENABLED':
        existing.enabled = rawValue?.trim();
        break;
    }

    byIndex.set(index, existing);
  }

  const descriptors: ParsedEnvInstanceDescriptor[] = [];
  for (const type of APP_TYPE_KEYS) {
    const byIndex = grouped.get(type);
    if (!byIndex) {
      continue;
    }

    const sortedIndices = [...byIndex.keys()].sort((a, b) => a - b);
    for (const index of sortedIndices) {
      const item = byIndex.get(index);
      if (!item) {
        continue;
      }

      const urlResult = parseOptionalAbsoluteHttpUrl(item.url);
      if (!item.url || item.url.length === 0 || !urlResult.isValid || !urlResult.value) {
        continue;
      }

      if (!item.apiKey || item.apiKey.length === 0) {
        continue;
      }

      const name = item.name && item.name.length > 0 ? item.name : defaultName(type, index);
      descriptors.push({
        type,
        index,
        url: urlResult.value,
        apiKey: item.apiKey,
        name,
        externalUrl: parseExternalUrlFromEnv(item.externalUrl),
        tags: parseTagsFromEnv(item.tags),
        enabled: parseEnabledFromEnv(item.enabled),
      });
    }
  }

  return descriptors;
}

function defaultName(type: ArrAppType, index: number): string {
  return index === 1 ? APP_LABELS[type] : `${APP_LABELS[type]} ${index}`;
}

type ArrInstanceEnvKeys = {
  all: string[];
  unsupported: string[];
};

function inspectArrInstanceEnvKeys(): ArrInstanceEnvKeys {
  const all: string[] = [];
  const unsupported: string[] = [];

  for (const [key] of Object.entries(Deno.env.toObject())) {
    const match = key.match(APP_INSTANCE_ENV_KEY_RE);
    if (!match) {
      continue;
    }

    all.push(key);
    const [, rawType] = match;
    const loweredType = rawType.toLowerCase();
    if (!isSupportedArrAppTypePrefix(loweredType)) {
      unsupported.push(key);
    }
  }

  all.sort((left, right) => left.localeCompare(right));
  unsupported.sort((left, right) => left.localeCompare(right));

  return { all, unsupported };
}

export async function reconcileEnvInstances(): Promise<ReconcileEnvInstancesResult> {
  const envKeys = inspectArrInstanceEnvKeys();
  await logger.debug('Discovered environment instance variables', {
    source: 'Setup',
    meta: {
      allEnvInstanceKeys: envKeys.all,
      unsupportedArrAppTypeKeys: envKeys.unsupported,
      count: envKeys.all.length,
    },
  });

  if (envKeys.unsupported.length > 0) {
    await logger.warn('Unsupported Arr app type detected in environment instance variables', {
      source: 'Setup',
      meta: { unsupportedArrAppTypeKeys: envKeys.unsupported },
    });
  }

  const metrics: ReconcileEnvInstancesResult = {
    created: 0,
    updated: 0,
    disabled: 0,
    skippedConflictUi: 0,
    skippedDuplicateEnvKey: 0,
    validationSuccesses: 0,
    validationFailures: 0,
    errors: 0,
  };

  const parsed = parseArrInstanceEnvVars();
  if (envKeys.all.length > 0 && parsed.length === 0) {
    await logger.warn('No environment instances parsed from env variables; check required URL+API_KEY pairs', {
      source: 'Setup',
      meta: { envInstanceKeys: envKeys.all },
    });
  }

  await logger.debug('Parsed environment instances for reconciliation', {
    source: 'Setup',
    meta: {
      count: parsed.length,
      instances: parsed.map((instance) => ({
        type: instance.type,
        index: instance.index,
        name: instance.name,
        url: instance.url,
        enabled: instance.enabled,
        tagCount: instance.tags.length,
      })),
    },
  });

  const seenApiKeyFingerprints = new Set<string>();
  const activeApiKeyFingerprints = new Set<string>();

  for (const descriptor of parsed) {
    let apiKeyFingerprint: string;
    try {
      apiKeyFingerprint = (await deriveArrInstanceApiKeyFingerprint(descriptor.apiKey)).value;
    } catch {
      metrics.errors += 1;
      continue;
    }

    if (seenApiKeyFingerprints.has(apiKeyFingerprint)) {
      metrics.skippedDuplicateEnvKey += 1;
      continue;
    }
    seenApiKeyFingerprints.add(apiKeyFingerprint);

    const encryptedApiKey = await encryptArrInstanceApiKey(descriptor.apiKey);
    const encryptedApiKeyPayload = {
      ciphertext: encryptedApiKey.credential.ciphertext,
      nonce: encryptedApiKey.credential.nonce,
      keyVersion: encryptedApiKey.credential.keyVersion,
      fingerprint: encryptedApiKey.fingerprint.value,
    };

    const sourceConflict = arrInstancesQueries.getBySourceAndName('ui', descriptor.name) !== undefined;
    if (sourceConflict) {
      metrics.skippedConflictUi += 1;
      continue;
    }

    const existing = arrInstancesQueries.getByApiKey(apiKeyFingerprint);
    if (existing && existing.source !== 'env') {
      metrics.skippedConflictUi += 1;
      continue;
    }

    const existingByName = !existing ? arrInstancesQueries.getBySourceAndName('env', descriptor.name) : undefined;

    activeApiKeyFingerprints.add(apiKeyFingerprint);

    try {
      if (config.validateInstances) {
        try {
          const isConnected = await validateInstanceConnection(descriptor);
          if (!isConnected) {
            metrics.validationFailures += 1;
            throw new Error(`Validation failed for ${descriptor.type} instance ${descriptor.name}`);
          }
        } catch (error) {
          if (!(error instanceof Error && error.message.startsWith('Validation failed for '))) {
            metrics.validationFailures += 1;
          }
          throw error;
        }

        metrics.validationSuccesses += 1;
      }

      if (existing && existing.source === 'env') {
        const updated = arrInstancesQueries.updateEnvInstanceByApiKey(
          apiKeyFingerprint,
          {
            type: descriptor.type,
            url: descriptor.url,
            externalUrl: descriptor.externalUrl,
            apiKey: '',
            name: descriptor.name,
            tags: descriptor.tags,
            enabled: descriptor.enabled,
            source: 'env',
          },
          encryptedApiKeyPayload
        );
        if (!updated) {
          throw new Error('No env instance found for requested API key');
        }

        metrics.updated += 1;
        continue;
      }

      if (existingByName && existingByName.source === 'env') {
        const updated = arrInstancesQueries.updateEnvInstanceById(
          existingByName.id,
          {
            type: descriptor.type,
            url: descriptor.url,
            externalUrl: descriptor.externalUrl,
            apiKey: '',
            name: descriptor.name,
            tags: descriptor.tags,
            enabled: descriptor.enabled,
            source: 'env',
          },
          encryptedApiKeyPayload
        );
        if (!updated) {
          throw new Error('No env instance found for name-based key rotation');
        }

        metrics.updated += 1;
        continue;
      }

      const id = arrInstancesQueries.create(
        {
          name: descriptor.name,
          type: descriptor.type,
          url: descriptor.url,
          externalUrl: descriptor.externalUrl,
          apiKey: '',
          apiKeyFingerprint: apiKeyFingerprint,
          tags: descriptor.tags,
          enabled: descriptor.enabled,
          source: 'env',
        },
        encryptedApiKeyPayload
      );
      if (id === 0) {
        throw new Error('Failed to create env instance');
      }

      metrics.created += 1;
    } catch {
      metrics.errors += 1;
    }
  }

  try {
    metrics.disabled = arrInstancesQueries.disableEnvInstancesMissingApiKeys([...activeApiKeyFingerprints]);
  } catch {
    metrics.errors += 1;
  }

  return metrics;
}
