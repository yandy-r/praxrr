import { config } from '$server/utils/config/config.ts';

const AES_KEY_BYTES = 32;
const ACTIVE_KEY_ENV = 'ARR_CREDENTIAL_MASTER_KEY';
const ACTIVE_KEY_VERSION_ENV = 'ARR_CREDENTIAL_MASTER_KEY_VERSION';
const PREVIOUS_KEYS_ENV = 'ARR_CREDENTIAL_PREVIOUS_KEYS';

interface RawKeyMaterial {
  readonly version: string;
  readonly bytes: Uint8Array;
}

interface EncryptionKeyRing {
  readonly activeVersion: string;
  readonly configuredKeys: Map<string, RawKeyMaterial>;
  readonly encryptionKeys: Map<string, CryptoKey>;
  readonly fingerprintKeys: Map<string, CryptoKey>;
}

function getBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data);
  return copy.buffer;
}

let keyRing: EncryptionKeyRing | null = null;
let keyRingInitializationError: Error | null = null;

function decodeBase64Key(rawKey: string, source: string): Uint8Array {
  const normalized = rawKey.trim();

  if (normalized.length === 0) {
    throw new Error(`${source} is required and must be a non-empty value`);
  }

  let decoded: string;
  try {
    decoded = atob(normalized);
  } catch {
    throw new Error(`${source} must be valid base64`);
  }

  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  if (bytes.length !== AES_KEY_BYTES) {
    throw new Error(`${source} must decode to exactly ${AES_KEY_BYTES} bytes`);
  }

  return bytes;
}

function normalizeVersion(rawVersion: string): string {
  const normalized = rawVersion.trim();
  if (normalized.length === 0) {
    throw new Error(`${ACTIVE_KEY_VERSION_ENV} must be a non-empty value`);
  }

  return normalized;
}

function parsePreviousKeysJson(rawKeys: string, activeVersion: string): Map<string, RawKeyMaterial> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new Error(`${PREVIOUS_KEYS_ENV} must be valid JSON`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${PREVIOUS_KEYS_ENV} must be a JSON object map`);
  }

  const previousKeys = new Map<string, RawKeyMaterial>();
  for (const [version, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') {
      throw new Error(`${PREVIOUS_KEYS_ENV} must map version names to base64 keys`);
    }

    const keyVersion = normalizeVersion(version);
    if (keyVersion === activeVersion || previousKeys.has(keyVersion)) {
      continue;
    }

    previousKeys.set(keyVersion, {
      version: keyVersion,
      bytes: decodeBase64Key(rawValue, `${PREVIOUS_KEYS_ENV}[${keyVersion}]`),
    });
  }

  return previousKeys;
}

function getConfiguredKeys(): EncryptionKeyRing {
  const rawMasterKey = config.arrCredentialMasterKey;
  if (!rawMasterKey) {
    throw new Error(
      `${ACTIVE_KEY_ENV} is required for Arr credential encryption operations. Configure it and restart the process.`
    );
  }

  const activeVersion = normalizeVersion(config.arrCredentialMasterKeyVersion ?? '');
  const configuredKeys = new Map<string, RawKeyMaterial>([
    [
      activeVersion,
      {
        version: activeVersion,
        bytes: decodeBase64Key(rawMasterKey, ACTIVE_KEY_ENV),
      },
    ],
  ]);

  const rawPreviousKeys = config.arrCredentialPreviousKeys?.trim();
  if (rawPreviousKeys) {
    for (const [version, keyMaterial] of parsePreviousKeysJson(rawPreviousKeys, activeVersion).entries()) {
      configuredKeys.set(version, keyMaterial);
    }
  }

  return {
    activeVersion,
    configuredKeys,
    encryptionKeys: new Map<string, CryptoKey>(),
    fingerprintKeys: new Map<string, CryptoKey>(),
  };
}

function getOrInitKeyRing(): EncryptionKeyRing {
  if (keyRing) {
    return keyRing;
  }

  if (keyRingInitializationError) {
    throw keyRingInitializationError;
  }

  try {
    keyRing = getConfiguredKeys();
    return keyRing;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('Unable to initialize Arr credential key ring');
    keyRingInitializationError = failure;
    throw failure;
  }
}

function getRawKey(version: string): RawKeyMaterial {
  const ring = getOrInitKeyRing();
  const keyMaterial = ring.configuredKeys.get(version);
  if (!keyMaterial) {
    throw new Error(`No Arr credential key configured for version ${version}`);
  }

  return keyMaterial;
}

async function importEncryptionKey(version: string): Promise<CryptoKey> {
  const key = getRawKey(version).bytes;
  return await crypto.subtle.importKey(
    'raw',
    getBuffer(key),
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

async function importFingerprintKey(version: string): Promise<CryptoKey> {
  const key = getRawKey(version).bytes;
  return await crypto.subtle.importKey(
    'raw',
    getBuffer(key),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
}

export type ArrCredentialKeyVersion = string;

export function getActiveArrCredentialKeyVersion(): ArrCredentialKeyVersion {
  return getOrInitKeyRing().activeVersion;
}

export async function getArrCredentialEncryptionKey(version?: ArrCredentialKeyVersion): Promise<CryptoKey> {
  const keyVersion = normalizeVersion(version ?? getActiveArrCredentialKeyVersion());
  const ring = getOrInitKeyRing();
  const cached = ring.encryptionKeys.get(keyVersion);
  if (cached) {
    return cached;
  }

  const imported = await importEncryptionKey(keyVersion);
  ring.encryptionKeys.set(keyVersion, imported);
  return imported;
}

export async function getArrCredentialFingerprintKey(version?: ArrCredentialKeyVersion): Promise<CryptoKey> {
  const keyVersion = normalizeVersion(version ?? getActiveArrCredentialKeyVersion());
  const ring = getOrInitKeyRing();
  const cached = ring.fingerprintKeys.get(keyVersion);
  if (cached) {
    return cached;
  }

  const imported = await importFingerprintKey(keyVersion);
  ring.fingerprintKeys.set(keyVersion, imported);
  return imported;
}
