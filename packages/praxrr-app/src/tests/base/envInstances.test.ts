import { assertEquals, assertExists, assertThrows } from '@std/assert';
import {
  parseArrInstanceEnvVars,
  parseTagsFromEnv,
  parseEnabledFromEnv,
  reconcileEnvInstances,
} from '../../lib/server/utils/arr/envInstances.ts';
import * as arrCredentialEncryption from '../../lib/server/utils/encryption/arr-credentials.ts';
import { db } from '../../lib/server/db/db.ts';
import { arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import { BaseArrClient } from '../../lib/server/utils/arr/base.ts';
import { config } from '../../lib/server/utils/config/config.ts';

const APP_INSTANCE_ENV_KEY_RE = /^([A-Z]+)_INSTANCE_(URL|API_KEY|NAME|EXTERNAL_URL|TAGS|ENABLED)_(\d+)$/;

const TEST_ARR_MASTER_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const TEST_ARR_MASTER_KEY_VERSION = 'v-task-3-2';

type Restore = () => void;

type MutableConfig = {
  arrCredentialMasterKey: string | null;
  arrCredentialMasterKeyVersion: string | null;
  arrCredentialPreviousKeys: string | null;
};

async function withArrCredentialConfig<T>(fn: () => T | Promise<T>): Promise<T> {
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
    return await fn();
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

async function withEnvVarsAsync(variables: Record<string, string>, test: () => Promise<void>): Promise<void> {
  const originalEnv = Deno.env.toObject();
  const managedKeys = Object.keys(originalEnv).filter((key) => APP_INSTANCE_ENV_KEY_RE.test(key));
  const restoredKeys: Record<string, string | undefined> = {};

  for (const key of managedKeys) {
    restoredKeys[key] = originalEnv[key];
    Deno.env.delete(key);
  }

  for (const [key, value] of Object.entries(variables)) {
    Deno.env.set(key, value);
  }

  try {
    await test();
  } finally {
    for (const key of Object.keys(restoredKeys)) {
      Deno.env.delete(key);
    }

    for (const [key, value] of Object.entries(restoredKeys)) {
      if (value !== undefined) {
        Deno.env.set(key, value);
      }
    }
  }
}

function withEnvVars(variables: Record<string, string>, test: () => void): void {
  const originalEnv = Deno.env.toObject();
  const managedKeys = Object.keys(originalEnv).filter((key) => APP_INSTANCE_ENV_KEY_RE.test(key));
  const restoredKeys: Record<string, string | undefined> = {};

  for (const key of managedKeys) {
    restoredKeys[key] = originalEnv[key];
    Deno.env.delete(key);
  }

  for (const [key, value] of Object.entries(variables)) {
    Deno.env.set(key, value);
  }

  try {
    test();
  } finally {
    for (const key of Object.keys(restoredKeys)) {
      Deno.env.delete(key);
    }

    for (const [key, value] of Object.entries(restoredKeys)) {
      if (value !== undefined) {
        Deno.env.set(key, value);
      }
    }
  }
}

Deno.test('parseArrInstanceEnvVars: skips instances with missing required fields', () => {
  withEnvVars(
    {
      RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
    },
    () => {
      assertEquals(parseArrInstanceEnvVars(), []);
    }
  );

  withEnvVars(
    {
      RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
    },
    () => {
      assertEquals(parseArrInstanceEnvVars(), []);
    }
  );
});

Deno.test('parseArrInstanceEnvVars: parses sparse indices with deterministic ordering', () => {
  withEnvVars(
    {
      RADARR_INSTANCE_URL_1: 'http://radarr-1.local:7878',
      RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
      RADARR_INSTANCE_NAME_1: 'Movies',
      RADARR_INSTANCE_URL_3: 'http://radarr-3.local:7878',
      RADARR_INSTANCE_API_KEY_3: 'radarr-key-3',
      RADARR_INSTANCE_TAGS_3: 'new, quality',
    },
    () => {
      const first = parseArrInstanceEnvVars();
      const second = parseArrInstanceEnvVars();

      assertEquals(first, [
        {
          type: 'radarr',
          index: 1,
          url: 'http://radarr-1.local:7878',
          apiKey: 'radarr-key-1',
          name: 'Movies',
          externalUrl: null,
          tags: [],
          enabled: true,
        },
        {
          type: 'radarr',
          index: 3,
          url: 'http://radarr-3.local:7878',
          apiKey: 'radarr-key-3',
          name: 'Radarr 3',
          externalUrl: null,
          tags: ['new', 'quality'],
          enabled: true,
        },
      ]);
      assertEquals(second, first);
    }
  );
});

Deno.test('parseTagsFromEnv: normalizes comma-separated tag strings', () => {
  assertEquals(parseTagsFromEnv('movies, quality, 4k,,local'), ['movies', 'quality', '4k', 'local']);
  assertEquals(parseTagsFromEnv(undefined), []);
});

Deno.test('reconcileEnvInstances skips env updates when a UI-owned name already exists', async () => {
  await withArrCredentialConfig(async () => {
    const restoreTargets: Restore[] = [];
    let updateAttempted = false;
    let createAttempted = false;

    patchTarget(db, 'execute', () => 0, restoreTargets);

    patchTarget(
      arrInstancesQueries,
      'getBySourceAndName',
      (_source: string, _name: string) => {
        if (_source === 'ui') {
          return {
            id: 19,
            name: 'UI-Managed Radarr',
            type: 'radarr',
            url: 'http://ui-radarr.local',
            external_url: null,
            api_key_fingerprint: 'ui-fingerprint',
            tags: null,
            enabled: 1,
            source: 'ui',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            api_key: '',
          };
        }

        return undefined;
      },
      restoreTargets
    );

    patchTarget(
      arrInstancesQueries,
      'getByApiKey',
      () => {
        return undefined;
      },
      restoreTargets
    );

    patchTarget(
      arrInstancesQueries,
      'updateEnvInstanceByApiKey',
      () => {
        updateAttempted = true;
        return true;
      },
      restoreTargets
    );

    patchTarget(
      arrInstancesQueries,
      'updateEnvInstanceById',
      () => {
        updateAttempted = true;
        return true;
      },
      restoreTargets
    );

    patchTarget(
      arrInstancesQueries,
      'create',
      () => {
        createAttempted = true;
        return 55;
      },
      restoreTargets
    );

    patchTarget(arrInstancesQueries, 'disableEnvInstancesMissingApiKeys', () => 0, restoreTargets);

    try {
      await withEnvVarsAsync(
        {
          RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
          RADARR_INSTANCE_API_KEY_1: 'radarr-ui-scope-key',
          RADARR_INSTANCE_NAME_1: 'UI-Managed Radarr',
        },
        async () => {
          const result = await reconcileEnvInstances();

          assertEquals(result.skippedConflictUi, 1);
          assertEquals(updateAttempted, false);
          assertEquals(createAttempted, false);
        }
      );
    } finally {
      for (const restore of restoreTargets.reverse()) {
        restore();
      }
    }
  });
});

Deno.test('reconcileEnvInstances updates env instances by deterministic fingerprint', async () => {
  await withArrCredentialConfig(async () => {
    const restores: Restore[] = [];
    let seenFingerprint: string | undefined;
    let updateByFingerprintCalled = false;

    const expected = await arrCredentialEncryption.deriveArrInstanceApiKeyFingerprint('env-dedup-key-007');

    patchTarget(db, 'execute', () => 0, restores);
    patchTarget(arrInstancesQueries, 'getBySourceAndName', () => undefined, restores);

    patchTarget(
      arrInstancesQueries,
      'getByApiKey',
      (fingerprint: string) => {
        seenFingerprint = fingerprint;
        if (fingerprint !== expected.value) {
          return undefined;
        }

        return {
          id: 44,
          name: 'Existing Env Radarr',
          type: 'radarr',
          url: 'http://existing-radarr.local',
          external_url: null,
          api_key_fingerprint: expected.value,
          tags: null,
          enabled: 1,
          source: 'env',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
          api_key: '',
        };
      },
      restores
    );

    patchTarget(
      arrInstancesQueries,
      'updateEnvInstanceByApiKey',
      () => {
        updateByFingerprintCalled = true;
        return true;
      },
      restores
    );

    patchTarget(arrInstancesQueries, 'disableEnvInstancesMissingApiKeys', () => 1, restores);

    try {
      await withEnvVarsAsync(
        {
          RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
          RADARR_INSTANCE_API_KEY_1: 'env-dedup-key-007',
          RADARR_INSTANCE_NAME_1: 'Updated By Fingerprint',
        },
        async () => {
          const result = await reconcileEnvInstances();
          assertEquals(seenFingerprint, expected.value);
          assertEquals(updateByFingerprintCalled, true);
          assertEquals(result.updated, 1);
        }
      );
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });
});

Deno.test('parseArrInstanceEnvVars: rejects invalid URLs and preserves explicit URL parse failures as skips', () => {
  withEnvVars(
    {
      RADARR_INSTANCE_URL_1: 'not a valid url',
      RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
    },
    () => {
      assertEquals(parseArrInstanceEnvVars(), []);
    }
  );

  withEnvVars(
    {
      RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
      RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
      RADARR_INSTANCE_EXTERNAL_URL_1: 'ftp://radarr.local',
    },
    () => {
      const parsed = parseArrInstanceEnvVars();
      assertEquals(parsed.length, 1);
      assertEquals(parsed[0].externalUrl, null);
    }
  );
});

Deno.test('parseArrInstanceEnvVars: rejects unsupported arr app types', () => {
  withEnvVars(
    {
      UNKNOWN_INSTANCE_URL_1: 'http://example.local:7878',
      UNKNOWN_INSTANCE_API_KEY_1: 'ignored-key',
    },
    () => {
      assertThrows(() => parseArrInstanceEnvVars(), Error, 'Unsupported arr app type in env var key: UNKNOWN');
    }
  );
});

Deno.test('parseEnabledFromEnv: normalizes common bool-like values', () => {
  assertEquals(parseEnabledFromEnv('false'), false);
  assertEquals(parseEnabledFromEnv('0'), false);
  assertEquals(parseEnabledFromEnv('true'), true);
  assertEquals(parseEnabledFromEnv('1'), true);
  assertEquals(parseEnabledFromEnv(undefined), true);
});

const HEALTHY_STATUS = { ok: true as const, appName: 'Radarr', version: '5.14.0.9383' };

function enableValidateInstances(restores: Restore[]): void {
  const mutable = config as unknown as { validateInstances: boolean };
  const original = mutable.validateInstances;
  mutable.validateInstances = true;
  restores.push(() => {
    mutable.validateInstances = original;
  });
}

Deno.test(
  'reconcileEnvInstances stamps detected_version on the CREATE branch when validation reports a version',
  async () => {
    await withArrCredentialConfig(async () => {
      const restores: Restore[] = [];
      let createdId: number | undefined;
      let setVersionArgs: { id: number; version: string } | undefined;

      patchTarget(db, 'execute', () => 0, restores);
      patchTarget(arrInstancesQueries, 'getBySourceAndName', () => undefined, restores);
      patchTarget(arrInstancesQueries, 'getByApiKey', () => undefined, restores);
      patchTarget(
        arrInstancesQueries,
        'create',
        () => {
          createdId = 77;
          return 77;
        },
        restores
      );
      patchTarget(
        arrInstancesQueries,
        'setDetectedVersion',
        (id: number, args: { version: string; detectedAt: string }) => {
          setVersionArgs = { id, version: args.version };
          return true;
        },
        restores
      );
      patchTarget(arrInstancesQueries, 'disableEnvInstancesMissingApiKeys', () => 0, restores);

      // Validation seam: report a healthy version without any network I/O.
      patchTarget(BaseArrClient.prototype, 'getSystemStatus', () => Promise.resolve(HEALTHY_STATUS), restores);
      enableValidateInstances(restores);

      try {
        await withEnvVarsAsync(
          {
            RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
            RADARR_INSTANCE_API_KEY_1: 'env-create-version-key',
            RADARR_INSTANCE_NAME_1: 'Fresh Env Radarr',
          },
          async () => {
            const result = await reconcileEnvInstances();

            assertEquals(result.created, 1);
            assertEquals(result.validationSuccesses, 1);
            assertExists(setVersionArgs);
            assertEquals(setVersionArgs?.id, createdId);
            assertEquals(setVersionArgs?.version, '5.14.0.9383');
          }
        );
      } finally {
        for (const restore of restores.reverse()) {
          restore();
        }
      }
    });
  }
);

Deno.test('reconcileEnvInstances does not stamp detected_version on the UPDATE branch at reconcile time', async () => {
  await withArrCredentialConfig(async () => {
    const restores: Restore[] = [];
    let updateCalled = false;
    let setVersionCalled = false;

    patchTarget(db, 'execute', () => 0, restores);
    patchTarget(arrInstancesQueries, 'getBySourceAndName', () => undefined, restores);
    patchTarget(
      arrInstancesQueries,
      'getByApiKey',
      (fingerprint: string) => ({
        id: 44,
        name: 'Existing Env Radarr',
        type: 'radarr',
        url: 'http://existing-radarr.local',
        external_url: null,
        api_key_fingerprint: fingerprint,
        tags: null,
        enabled: 1,
        source: 'env' as const,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        api_key: '',
      }),
      restores
    );
    patchTarget(
      arrInstancesQueries,
      'updateEnvInstanceByApiKey',
      () => {
        updateCalled = true;
        return true;
      },
      restores
    );
    patchTarget(
      arrInstancesQueries,
      'setDetectedVersion',
      () => {
        setVersionCalled = true;
        return true;
      },
      restores
    );
    patchTarget(arrInstancesQueries, 'disableEnvInstancesMissingApiKeys', () => 1, restores);

    patchTarget(BaseArrClient.prototype, 'getSystemStatus', () => Promise.resolve(HEALTHY_STATUS), restores);
    enableValidateInstances(restores);

    try {
      await withEnvVarsAsync(
        {
          RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
          RADARR_INSTANCE_API_KEY_1: 'env-update-version-key',
          RADARR_INSTANCE_NAME_1: 'Existing Env Radarr',
        },
        async () => {
          const result = await reconcileEnvInstances();

          assertEquals(result.updated, 1);
          assertEquals(updateCalled, true);
          // Version stamping is deferred to the first sync for existing env instances.
          assertEquals(setVersionCalled, false);
        }
      );
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });
});
