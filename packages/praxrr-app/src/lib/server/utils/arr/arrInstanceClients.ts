import { decryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import type { ArrClientOptions } from './base.ts';
import { createArrClient } from './factory.ts';
import type { BaseArrClient } from './base.ts';
import type { ArrType } from './types.ts';
import { assertSafeArrUrl } from './urlSafety.ts';

export interface ArrInstanceCredentialIdentity {
  readonly fingerprint: string;
  readonly keyVersion: string;
  readonly revision: string;
}

export interface ArrInstanceReviewClient {
  readonly client: BaseArrClient;
  readonly credentialIdentity: ArrInstanceCredentialIdentity;
}

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

function getCredentialSnapshot(instanceId: number) {
  try {
    return arrInstanceCredentialsQueries.getByInstanceId(instanceId);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Database not initialized') ||
        error.message.includes('no such table: arr_instance_credentials'))
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Acquire one client and its non-secret identity from the same authoritative credential snapshot.
 *
 * Reviewed preview callers must keep this pair together: a second credential query between target
 * hashing and client construction would re-open a rotation TOCTOU window.
 */
export async function getArrInstanceReviewClient(
  type: ArrType,
  instance: Pick<ArrInstance, 'id' | 'url' | 'api_key' | 'api_key_fingerprint' | 'updated_at'>,
  options?: ArrClientOptions
): Promise<ArrInstanceReviewClient> {
  assertSafeArrUrl(instance.url);
  const credential = getCredentialSnapshot(instance.id);

  if (!credential) {
    if (!instance.api_key || !instance.api_key_fingerprint) {
      throw new Error(`No Arr credentials found for instance ${instance.id}`);
    }
    return Object.freeze({
      client: createArrClient(type, instance.url, instance.api_key, options),
      credentialIdentity: Object.freeze({
        fingerprint: instance.api_key_fingerprint,
        keyVersion: 'legacy',
        revision: instance.updated_at,
      }),
    });
  }

  const apiKey = await decryptArrInstanceApiKey({
    keyVersion: credential.key_version,
    nonce: credential.nonce,
    ciphertext: credential.ciphertext,
  });
  return Object.freeze({
    client: createArrClient(type, instance.url, apiKey, options),
    credentialIdentity: Object.freeze({
      fingerprint: credential.fingerprint,
      keyVersion: credential.key_version,
      revision: credential.updated_at,
    }),
  });
}

export async function getArrInstanceClient(
  type: ArrType,
  instanceId: number,
  url: string,
  options?: ArrClientOptions,
  cache?: ArrInstanceClientCache
): Promise<BaseArrClient> {
  assertSafeArrUrl(url);

  const credentials = getCredentialSnapshot(instanceId);
  if (!credentials) {
    let instance;
    try {
      instance = arrInstancesQueries.getById(instanceId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Database not initialized')) {
        throw new Error(`No Arr credentials found for instance ${instanceId}`);
      }

      throw error;
    }

    if (!instance || !instance.api_key) {
      throw new Error(`No Arr credentials found for instance ${instanceId}`);
    }

    return createArrClient(type, url, instance.api_key, options);
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
