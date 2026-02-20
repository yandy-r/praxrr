import { decryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import type { ArrClientOptions } from './base.ts';
import { createArrClient } from './factory.ts';
import type { BaseArrClient } from './base.ts';
import type { ArrType } from './types.ts';

export interface ArrInstanceClientCacheEntry {
  keyVersion: string;
  client: BaseArrClient;
}

export type ArrInstanceClientCache = Map<string, ArrInstanceClientCacheEntry>;

function getCacheKey(instanceId: number, keyVersion: string): string {
  return `${instanceId}:${keyVersion}`;
}

function invalidateInstanceClientCache(cache: ArrInstanceClientCache, instanceId: number): void {
  const prefix = `${instanceId}:`;
  for (const cacheKey of cache.keys()) {
    if (cacheKey.startsWith(prefix)) {
      cache.delete(cacheKey);
    }
  }
}

function invalidateMismatchedInstanceClientCache(
  cache: ArrInstanceClientCache,
  instanceId: number,
  keyVersion: string
): boolean {
  const currentKey = getCacheKey(instanceId, keyVersion);
  let mismatched = false;

  for (const cacheKey of cache.keys()) {
    if (cacheKey.startsWith(`${instanceId}:`) && cacheKey !== currentKey) {
      mismatched = true;
      break;
    }
  }

  if (mismatched) {
    invalidateInstanceClientCache(cache, instanceId);
  }

  return mismatched;
}

export function createArrInstanceClientCache(): ArrInstanceClientCache {
  return new Map();
}

export async function getArrInstanceClient(
  type: ArrType,
  instanceId: number,
  url: string,
  options?: ArrClientOptions,
  cache?: ArrInstanceClientCache
): Promise<BaseArrClient> {
  const credentials = arrInstanceCredentialsQueries.getByInstanceId(instanceId);
  if (!credentials) {
    throw new Error(`No Arr credentials found for instance ${instanceId}`);
  }

  const cacheKey = getCacheKey(instanceId, credentials.key_version);

  if (cache) {
    invalidateMismatchedInstanceClientCache(cache, instanceId, credentials.key_version);

    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached.client;
    }
  }

  let apiKey = '';
  try {
    apiKey = await decryptArrInstanceApiKey({
      keyVersion: credentials.key_version,
      nonce: credentials.nonce,
      ciphertext: credentials.ciphertext,
    });
  } catch (error) {
    if (cache) {
      invalidateInstanceClientCache(cache, instanceId);
    }
    throw error;
  }

  const client = createArrClient(type, url, apiKey, options);

  if (cache) {
    cache.set(cacheKey, { keyVersion: credentials.key_version, client });
  }

  return client;
}
