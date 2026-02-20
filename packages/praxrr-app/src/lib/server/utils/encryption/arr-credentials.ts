import {
  getArrCredentialEncryptionKey,
  getArrCredentialFingerprintKey,
  getActiveArrCredentialKeyVersion,
  type ArrCredentialKeyVersion,
} from './keys.ts';

const NONCE_BYTES = 12;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface ArrCredentialEnvelope {
  readonly keyVersion: ArrCredentialKeyVersion;
  readonly nonce: string;
  readonly ciphertext: string;
}

export interface ArrApiKeyFingerprint {
  readonly keyVersion: ArrCredentialKeyVersion;
  readonly value: string;
}

export interface ArrApiKeyWriteData {
  readonly credential: ArrCredentialEnvelope;
  readonly fingerprint: ArrApiKeyFingerprint;
}

function normalizeVersion(rawVersion: string): ArrCredentialKeyVersion {
  const version = rawVersion.trim();
  if (version.length === 0) {
    throw new Error('Arr credential key version must be a non-empty value');
  }

  return version;
}

function encodeBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function decodeBase64(base64: string, fieldName: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error(`Invalid base64 ${fieldName}`);
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function getBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

async function createFingerprint(
  plaintext: Uint8Array,
  keyVersion: ArrCredentialKeyVersion,
): Promise<string> {
  const key = await getArrCredentialFingerprintKey(keyVersion);
  const value = await crypto.subtle.sign('HMAC', key, getBuffer(plaintext));

  return encodeBase64(new Uint8Array(value));
}

function ensureBase64Fields(payload: ArrCredentialEnvelope): ArrCredentialEnvelope {
  if (!payload.keyVersion.trim()) {
    throw new Error('Arr credential key version is required');
  }

  if (!payload.nonce.trim()) {
    throw new Error('Arr credential nonce is required');
  }

  if (!payload.ciphertext.trim()) {
    throw new Error('Arr credential ciphertext is required');
  }

  return payload;
}

export async function encryptArrInstanceApiKey(apiKey: string): Promise<ArrApiKeyWriteData> {
  const keyVersion = getActiveArrCredentialKeyVersion();
  const resolvedVersion = normalizeVersion(keyVersion);

  const key = await getArrCredentialEncryptionKey(resolvedVersion);
  const plaintext = TEXT_ENCODER.encode(apiKey);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: getBuffer(nonce),
    },
    key,
    getBuffer(plaintext),
  );
  const ciphertext = encodeBase64(new Uint8Array(cipherBuffer));
  const fingerprint = await createFingerprint(plaintext, resolvedVersion);

  return {
    credential: {
      keyVersion: resolvedVersion,
      nonce: encodeBase64(nonce),
      ciphertext,
    },
    fingerprint: {
      keyVersion: resolvedVersion,
      value: fingerprint,
    },
  };
}

export async function decryptArrInstanceApiKey(payload: ArrCredentialEnvelope): Promise<string> {
  const normalized = ensureBase64Fields(payload);
  const keyVersion = normalizeVersion(normalized.keyVersion);
  const key = await getArrCredentialEncryptionKey(keyVersion);

  const nonce = decodeBase64(normalized.nonce, 'nonce');
  if (nonce.length !== NONCE_BYTES) {
    throw new Error('Arr credential nonce must be exactly 12 bytes');
  }

  const ciphertext = decodeBase64(normalized.ciphertext, 'ciphertext');

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
      name: 'AES-GCM',
      iv: getBuffer(nonce),
      },
      key,
      getBuffer(ciphertext),
    );

    return TEXT_DECODER.decode(plaintext);
  } catch {
    throw new Error('Unable to decrypt Arr API key');
  }
}

export async function deriveArrInstanceApiKeyFingerprint(
  apiKey: string,
  keyVersion?: ArrCredentialKeyVersion,
): Promise<ArrApiKeyFingerprint> {
  const resolvedVersion = normalizeVersion(keyVersion ?? getActiveArrCredentialKeyVersion());
  const plaintext = TEXT_ENCODER.encode(apiKey);
  const value = await createFingerprint(plaintext, resolvedVersion);

  return {
    keyVersion: resolvedVersion,
    value,
  };
}
