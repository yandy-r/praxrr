import { assertEquals } from '@std/assert';
import { config } from '../../lib/server/utils/config/config.ts';
import { db } from '../../lib/server/db/db.ts';
import { arrInstanceCredentialsQueries } from '../../lib/server/db/queries/arrInstanceCredentials.ts';
import { arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import {
  deriveArrInstanceApiKeyFingerprint,
  encryptArrInstanceApiKey,
} from '../../lib/server/utils/encryption/arr-credentials.ts';
import {
  getAllArrCredentialKeyVersions,
  __resetArrCredentialKeyRingForTest,
} from '../../lib/server/utils/encryption/keys.ts';

const TEST_ARR_MASTER_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const TEST_ARR_MASTER_KEY_VERSION = 'v-task-3-2';
// 32-byte key (44 chars with padding); must differ from TEST_ARR_MASTER_KEY
const TEST_ARR_PREVIOUS_KEY_V2 = 'CQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

type Restore = () => void;

type MutableConfig = {
  arrCredentialMasterKey: string | null;
  arrCredentialMasterKeyVersion: string | null;
  arrCredentialPreviousKeys: string | null;
};

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

Deno.test('getAllArrCredentialKeyVersions returns at least the active version', async () => {
  await withArrCredentialConfig(async () => {
    const versions = getAllArrCredentialKeyVersions();
    assertEquals(versions.length >= 1, true);
    assertEquals(versions.includes(TEST_ARR_MASTER_KEY_VERSION), true);
  });
});

Deno.test('getByAnyFingerprint with empty array returns undefined', () => {
  assertEquals(arrInstanceCredentialsQueries.getByAnyFingerprint([]), undefined);
});

Deno.test(
  'getAllArrCredentialKeyVersions returns both active and previous versions; same plaintext yields different fingerprints per version',
  async () => {
    const mutableConfig = config as unknown as MutableConfig;
    const originalMasterKey = mutableConfig.arrCredentialMasterKey;
    const originalKeyVersion = mutableConfig.arrCredentialMasterKeyVersion;
    const originalPreviousKeys = mutableConfig.arrCredentialPreviousKeys;
    const originalEnvKey = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY');
    const originalEnvVersion = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY_VERSION');
    const originalEnvPrevious = Deno.env.get('ARR_CREDENTIAL_PREVIOUS_KEYS');

    __resetArrCredentialKeyRingForTest();
    mutableConfig.arrCredentialMasterKey = TEST_ARR_MASTER_KEY;
    mutableConfig.arrCredentialMasterKeyVersion = TEST_ARR_MASTER_KEY_VERSION;
    const previousKeysJson = JSON.stringify({ v2: TEST_ARR_PREVIOUS_KEY_V2 });
    mutableConfig.arrCredentialPreviousKeys = previousKeysJson;
    Deno.env.set('ARR_CREDENTIAL_MASTER_KEY', TEST_ARR_MASTER_KEY);
    Deno.env.set('ARR_CREDENTIAL_MASTER_KEY_VERSION', TEST_ARR_MASTER_KEY_VERSION);
    Deno.env.set('ARR_CREDENTIAL_PREVIOUS_KEYS', previousKeysJson);

    try {
      const versions = getAllArrCredentialKeyVersions();
      assertEquals(versions.length, 2);
      assertEquals(versions.includes(TEST_ARR_MASTER_KEY_VERSION), true);
      assertEquals(versions.includes('main'), true);

      const plaintext = 'same-api-key-across-versions';
      const fpActive = await deriveArrInstanceApiKeyFingerprint(plaintext, TEST_ARR_MASTER_KEY_VERSION);
      const fpV2 = await deriveArrInstanceApiKeyFingerprint(plaintext, 'main');
      assertEquals(fpActive.value !== fpV2.value, true);
    } finally {
      mutableConfig.arrCredentialMasterKey = originalMasterKey;
      mutableConfig.arrCredentialMasterKeyVersion = originalKeyVersion;
      mutableConfig.arrCredentialPreviousKeys = originalPreviousKeys;
      if (originalEnvKey === undefined) Deno.env.delete('ARR_CREDENTIAL_MASTER_KEY');
      else Deno.env.set('ARR_CREDENTIAL_MASTER_KEY', originalEnvKey);
      if (originalEnvVersion === undefined) Deno.env.delete('ARR_CREDENTIAL_MASTER_KEY_VERSION');
      else Deno.env.set('ARR_CREDENTIAL_MASTER_KEY_VERSION', originalEnvVersion);
      if (originalEnvPrevious === undefined) Deno.env.delete('ARR_CREDENTIAL_PREVIOUS_KEYS');
      else Deno.env.set('ARR_CREDENTIAL_PREVIOUS_KEYS', originalEnvPrevious);
      __resetArrCredentialKeyRingForTest();
    }
  }
);

Deno.test('deriveArrInstanceApiKeyFingerprint is deterministic for same input', async () => {
  const first = await withArrCredentialConfig(() => deriveArrInstanceApiKeyFingerprint('same-key-123'));
  const second = await withArrCredentialConfig(() => deriveArrInstanceApiKeyFingerprint('same-key-123'));

  assertEquals(first.value, second.value);
  assertEquals(first.keyVersion, TEST_ARR_MASTER_KEY_VERSION);
  assertEquals(first.value.length > 0, true);
});

Deno.test('encryptArrInstanceApiKey produces encrypted-at-rest payload and decryptable runtime value', async () => {
  const encrypted = await withArrCredentialConfig(() => encryptArrInstanceApiKey('cleartext-key-456'));

  assertEquals(encrypted.credential.ciphertext.includes('cleartext-key-456'), false);
  assertEquals(encrypted.credential.ciphertext.length > 0, true);
  assertEquals(encrypted.fingerprint.value.length > 0, true);

  const restored = await withArrCredentialConfig(() => __testDecryptEnvelope(encrypted.credential));

  assertEquals(restored, 'cleartext-key-456');
});

async function __testDecryptEnvelope(payload: {
  keyVersion: string;
  nonce: string;
  ciphertext: string;
}): Promise<string> {
  const { decryptArrInstanceApiKey } = await import('../../lib/server/utils/encryption/arr-credentials.ts');
  return decryptArrInstanceApiKey(payload);
}

Deno.test(
  'arrInstances create writes ciphertext in instance row and stores encrypted credential separately',
  async () => {
    const executeCalls: unknown[][] = [];
    const executedSql: string[] = [];
    const restores: Restore[] = [];
    let credentialCreated = false;

    patchTarget(
      db,
      'beginTransaction',
      () => {
        // No-op for this regression harness.
      },
      restores
    );
    patchTarget(
      db,
      'commit',
      () => {
        // No-op for this regression harness.
      },
      restores
    );
    patchTarget(
      db,
      'rollback',
      () => {
        // No-op for this regression harness.
      },
      restores
    );
    patchTarget(
      db,
      'execute',
      (sql: string, ...params: unknown[]) => {
        executeCalls.push(params);
        executedSql.push(sql);
        return 1;
      },
      restores
    );
    patchTarget(db, 'queryFirst', (() => ({ id: 88 }) as { id: number }) as typeof db.queryFirst, restores);
    patchTarget(
      arrInstanceCredentialsQueries,
      'create',
      () => {
        credentialCreated = true;
      },
      restores
    );

    try {
      const plainApiKey = 'user-supplied-api-key';
      const encrypted = await withArrCredentialConfig(() => encryptArrInstanceApiKey(plainApiKey));

      const id = arrInstancesQueries.create(
        {
          name: 'Radarr Main',
          type: 'radarr',
          url: 'http://radarr.local:7878',
          apiKey: encrypted.credential.ciphertext,
          apiKeyFingerprint: encrypted.fingerprint.value,
        },
        {
          ciphertext: encrypted.credential.ciphertext,
          nonce: encrypted.credential.nonce,
          keyVersion: encrypted.credential.keyVersion,
          fingerprint: encrypted.fingerprint.value,
        }
      );

      assertEquals(id, 88);
      assertEquals(executeCalls.length, 1);
      assertEquals(executedSql[0].includes('INSERT INTO arr_instances'), true);
      assertEquals(executeCalls[0][4], '');
      assertEquals(executeCalls[0][5], encrypted.fingerprint.value);
      assertEquals(executeCalls[0][4] === plainApiKey, false);
      assertEquals(credentialCreated, true);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  }
);

Deno.test('arrInstances select projection redacts api_key field in query responses', () => {
  const restores: Restore[] = [];
  const executeCalls: unknown[][] = [];

  patchTarget(
    db,
    'queryFirst',
    ((sql: string, ..._params: unknown[]) => {
      executeCalls.push([sql]);
      return {
        id: 1,
        name: 'Radarr main',
        type: 'radarr',
        url: 'http://radarr.local:7878',
        external_url: null,
        api_key_fingerprint: 'f',
        tags: null,
        enabled: 1,
        source: 'ui',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        api_key: '',
      };
    }) as typeof db.queryFirst,
    restores
  );

  try {
    const instance = arrInstancesQueries.getById(1);
    assertEquals(instance?.api_key, '');
    assertEquals(executeCalls.length, 1);
    assertEquals(executeCalls[0][0]!.toString().includes("'' AS api_key"), true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
