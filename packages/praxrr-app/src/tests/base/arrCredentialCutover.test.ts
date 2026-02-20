import { assertEquals, assertRejects } from '@std/assert';
import { config } from '../../lib/server/utils/config/config.ts';
import { arrInstanceCredentialsQueries } from '../../lib/server/db/queries/arrInstanceCredentials.ts';
import { getArrInstanceClient } from '../../lib/server/utils/arr/arrInstanceClients.ts';
import { encryptArrInstanceApiKey } from '../../lib/server/utils/encryption/arr-credentials.ts';

type Restore = () => void;

type MutableConfig = {
  arrCredentialMasterKey: string | null;
  arrCredentialMasterKeyVersion: string | null;
  arrCredentialPreviousKeys: string | null;
};

const TEST_ARR_MASTER_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const TEST_ARR_MASTER_KEY_VERSION = 'v-task-3-2';

function withArrCredentialConfig<T>(fn: () => T | Promise<T>): Promise<T> {
  const mutableConfig = config as unknown as MutableConfig;
  const originalConfig = {
    masterKey: mutableConfig.arrCredentialMasterKey,
    keyVersion: mutableConfig.arrCredentialMasterKeyVersion,
    previousKeys: mutableConfig.arrCredentialPreviousKeys,
  };

  const originalEnvKey = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY');
  const originalEnvVersion = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY_VERSION');

  Deno.env.set('ARR_CREDENTIAL_MASTER_KEY', TEST_ARR_MASTER_KEY);
  Deno.env.set('ARR_CREDENTIAL_MASTER_KEY_VERSION', TEST_ARR_MASTER_KEY_VERSION);

  mutableConfig.arrCredentialMasterKey = TEST_ARR_MASTER_KEY;
  mutableConfig.arrCredentialMasterKeyVersion = TEST_ARR_MASTER_KEY_VERSION;
  mutableConfig.arrCredentialPreviousKeys = null;

  try {
    return Promise.resolve(fn());
  } finally {
    mutableConfig.arrCredentialMasterKey = originalConfig.masterKey;
    mutableConfig.arrCredentialMasterKeyVersion = originalConfig.keyVersion;
    mutableConfig.arrCredentialPreviousKeys = originalConfig.previousKeys;

    if (originalEnvKey === undefined) {
      Deno.env.delete('ARR_CREDENTIAL_MASTER_KEY');
    } else {
      Deno.env.set('ARR_CREDENTIAL_MASTER_KEY', originalEnvKey);
    }

    if (originalEnvVersion === undefined) {
      Deno.env.delete('ARR_CREDENTIAL_MASTER_KEY_VERSION');
    } else {
      Deno.env.set('ARR_CREDENTIAL_MASTER_KEY_VERSION', originalEnvVersion);
    }
  }
}

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('getArrInstanceClient decrypts credential payload for runtime Arr use', async () => {
  const restores: Restore[] = [];
  const capturedHeaders = new Map<string, string | null>();

  patchTarget(
    globalThis,
    'fetch',
    ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      capturedHeaders.set('X-Api-Key', request.headers.get('X-Api-Key'));
      return Promise.resolve(
        new Response(JSON.stringify({ appName: 'Radarr', version: 'v0.0.1', osName: 'linux' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as typeof fetch,
    restores
  );

  try {
    const encrypted = await withArrCredentialConfig(() => encryptArrInstanceApiKey('runtime-secret-key-007'));

    patchTarget(
      arrInstanceCredentialsQueries,
      'getByInstanceId',
      () => ({
        instance_id: 21,
        ciphertext: encrypted.credential.ciphertext,
        nonce: encrypted.credential.nonce,
        key_version: encrypted.credential.keyVersion,
        fingerprint: encrypted.fingerprint.value,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }),
      restores
    );

    const client = await getArrInstanceClient('radarr', 21, 'http://radarr.local');
    const connected = await client.testConnection();
    client.close();

    assertEquals(connected, true);
    assertEquals(capturedHeaders.get('X-Api-Key'), 'runtime-secret-key-007');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('getArrInstanceClient throws when no credentials exist for instance', async () => {
  const restores: Restore[] = [];

  patchTarget(arrInstanceCredentialsQueries, 'getByInstanceId', () => undefined, restores);

  try {
    await assertRejects(
      () => getArrInstanceClient('sonarr', 777, 'http://sonarr.local'),
      Error,
      'No Arr credentials found for instance 777'
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('getArrInstanceClient rejects on corrupted ciphertext', async () => {
  await withArrCredentialConfig(async () => {
    const restores: Restore[] = [];

    patchTarget(
      arrInstanceCredentialsQueries,
      'getByInstanceId',
      () => ({
        instance_id: 22,
        ciphertext: 'not-base64-ciphertext',
        nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
        key_version: TEST_ARR_MASTER_KEY_VERSION,
        fingerprint: 'unused-fingerprint',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }),
      restores
    );

    try {
      await assertRejects(
        () => getArrInstanceClient('lidarr', 22, 'http://lidarr.local'),
        Error,
        'Arr credential nonce must be exactly 12 bytes'
      );
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });
});
