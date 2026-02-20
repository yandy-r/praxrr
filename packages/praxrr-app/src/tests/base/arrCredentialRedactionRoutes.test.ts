import { assertEquals, assertFalse } from '@std/assert';
import type { TestContext } from './BaseTest.ts';
import { BaseTest } from './BaseTest.ts';
import { aiSettingsQueries } from '../../lib/server/db/queries/aiSettings.ts';
import { arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '../../lib/server/db/queries/arrInstanceCredentials.ts';
import { authSettingsQueries } from '../../lib/server/db/queries/authSettings.ts';
import { backupSettingsQueries } from '../../lib/server/db/queries/backupSettings.ts';
import { generalSettingsQueries } from '../../lib/server/db/queries/generalSettings.ts';
import { logSettingsQueries } from '../../lib/server/db/queries/logSettings.ts';
import { sessionsQueries } from '../../lib/server/db/queries/sessions.ts';
import { config } from '../../lib/server/utils/config/config.ts';
import { maskApiKey } from '../../lib/shared/utils/masking.ts';
import { tmdbSettingsQueries } from '../../lib/server/db/queries/tmdbSettings.ts';
import type { ArrInstanceCredential } from '../../lib/server/db/queries/arrInstanceCredentials.ts';
import type { ArrInstance } from '../../lib/server/db/queries/arrInstances.ts';
import { SonarrClient } from '../../lib/server/utils/arr/clients/sonarr.ts';
import { load as arrLayoutLoad } from '../../routes/arr/[id]/+layout.server.ts';
import { GET as libraryEpisodesGet } from '../../routes/api/v1/arr/library/episodes/+server.ts';
import { usersQueries } from '../../lib/server/db/queries/users.ts';
import { load as settingsGeneralLoad } from '../../routes/settings/general/+page.server.ts';
import { load as settingsSecurityLoad } from '../../routes/settings/security/+page.server.ts';

type ArrLayoutLoad = typeof arrLayoutLoad;
type LibraryEpisodesGet = typeof libraryEpisodesGet;

type MutableConfig = {
  arrCredentialMasterKey: string | null;
  arrCredentialMasterKeyVersion: string | null;
  arrCredentialPreviousKeys: string | null;
};

const SECRET_API_KEY = 'fixture-arr-api-key-redaction-001';
const FIXTURE_TIMESTAMP = '2025-01-01T00:00:00.000Z';
const TEST_MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const TEST_MASTER_KEY_VERSION = 'task-3.3-redaction';
const TEST_NONCE = 'AAAAAAAAAAAAAAAA';

class ArrCredentialRedactionRoutesTest extends BaseTest {
  private restoreStack: Array<() => void> = [];

  protected override beforeEach(_context: TestContext): void {
    this.restoreStack = [];
    this.configureEncryptionEnvironment();
  }

  protected override afterEach(_context: TestContext): void {
    for (const restore of this.restoreStack.reverse()) {
      restore();
    }
  }

  private configureEncryptionEnvironment(): void {
    const previousMasterKey = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY');
    const previousMasterKeyVersion = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY_VERSION');
    const mutableConfig = config as unknown as MutableConfig;
    const previousConfig = {
      masterKey: mutableConfig.arrCredentialMasterKey,
      masterKeyVersion: mutableConfig.arrCredentialMasterKeyVersion,
      previousKeys: mutableConfig.arrCredentialPreviousKeys,
    };

    if (previousMasterKey === undefined) {
      this.restoreStack.push(() => {
        Deno.env.delete('ARR_CREDENTIAL_MASTER_KEY');
      });
    } else {
      this.restoreStack.push(() => {
        Deno.env.set('ARR_CREDENTIAL_MASTER_KEY', previousMasterKey);
      });
    }

    if (previousMasterKeyVersion === undefined) {
      this.restoreStack.push(() => {
        Deno.env.delete('ARR_CREDENTIAL_MASTER_KEY_VERSION');
      });
    } else {
      this.restoreStack.push(() => {
        Deno.env.set('ARR_CREDENTIAL_MASTER_KEY_VERSION', previousMasterKeyVersion);
      });
    }

    this.restoreStack.push(() => {
      mutableConfig.arrCredentialMasterKey = previousConfig.masterKey;
    });
    this.restoreStack.push(() => {
      mutableConfig.arrCredentialMasterKeyVersion = previousConfig.masterKeyVersion;
    });
    this.restoreStack.push(() => {
      mutableConfig.arrCredentialPreviousKeys = previousConfig.previousKeys;
    });

    Deno.env.set('ARR_CREDENTIAL_MASTER_KEY', TEST_MASTER_KEY);
    Deno.env.set('ARR_CREDENTIAL_MASTER_KEY_VERSION', TEST_MASTER_KEY_VERSION);
    mutableConfig.arrCredentialMasterKey = TEST_MASTER_KEY;
    mutableConfig.arrCredentialMasterKeyVersion = TEST_MASTER_KEY_VERSION;
    mutableConfig.arrCredentialPreviousKeys = null;
  }

  private makeInstanceFixture(instanceId: number): ArrInstance {
    return {
      id: instanceId,
      name: 'Fixture Sonarr',
      type: 'sonarr',
      url: 'http://sonarr.internal',
      external_url: 'https://sonarr.example',
      api_key_fingerprint: 'fixture-fingerprint',
      api_key: SECRET_API_KEY,
      tags: null,
      enabled: 1,
      source: 'ui',
      created_at: FIXTURE_TIMESTAMP,
      updated_at: FIXTURE_TIMESTAMP,
    };
  }

  private makeInstanceCredentialFixture(instanceId: number): ArrInstanceCredential {
    return {
      instance_id: instanceId,
      ciphertext: 'YQ==',
      nonce: TEST_NONCE,
      key_version: TEST_MASTER_KEY_VERSION,
      fingerprint: 'fixture-fingerprint',
      created_at: FIXTURE_TIMESTAMP,
      updated_at: FIXTURE_TIMESTAMP,
    };
  }

  private patchGeneralSettingsLoadDependencies(tmdbApiKey: string, aiApiKey: string): void {
    this.installPatch(
      logSettingsQueries,
      'get',
      () => ({
        id: 1,
        retention_days: 30,
        min_level: 'INFO',
        enabled: 1,
        file_logging: 1,
        console_logging: 1,
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      }),
      this.restoreStack
    );

    this.installPatch(
      backupSettingsQueries,
      'get',
      () => ({
        id: 1,
        schedule: 'daily',
        retention_days: 30,
        enabled: 1,
        include_database: 1,
        compression_enabled: 1,
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      }),
      this.restoreStack
    );

    this.installPatch(
      generalSettingsQueries,
      'get',
      () => ({
        id: 1,
        apply_default_delay_profiles: 1,
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      }),
      this.restoreStack
    );

    this.installPatch(
      tmdbSettingsQueries,
      'get',
      () => ({
        id: 1,
        api_key: tmdbApiKey,
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      }),
      this.restoreStack
    );

    this.installPatch(
      aiSettingsQueries,
      'get',
      () => ({
        id: 1,
        enabled: 1,
        api_url: 'https://api.example.com',
        api_key: aiApiKey,
        model: 'gpt-4o-mini',
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      }),
      this.restoreStack
    );
  }

  private patchSecuritySettingsLoadDependencies(apiKey: string | null): void {
    this.installPatch(
      usersQueries,
      'getByUsername',
      () => ({
        id: 1,
        username: 'admin',
        password_hash: 'bcrypt-hash',
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      }),
      this.restoreStack
    );

    this.installPatch(
      usersQueries,
      'getById',
      () => ({
        id: 1,
        username: 'admin',
        password_hash: 'bcrypt-hash',
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      }),
      this.restoreStack
    );

    this.installPatch(
      sessionsQueries,
      'getByUserId',
      () => [],
      this.restoreStack
    );

    this.installPatch(
      authSettingsQueries,
      'getApiKey',
      () => apiKey,
      this.restoreStack
    );
  }

  private patchArrCredentialDecryptor(): void {
    const originalDecrypt = crypto.subtle.decrypt;
    const plaintext = new TextEncoder().encode(SECRET_API_KEY);

    crypto.subtle.decrypt = (() => {
      return Promise.resolve(plaintext.buffer.slice(0));
    }) as typeof crypto.subtle.decrypt;

    this.restoreStack.push(() => {
      crypto.subtle.decrypt = originalDecrypt;
    });
  }

  private patchSonarrClientGet(): void {
    this.installPatch(
      SonarrClient.prototype,
      'get',
      ((path: string) => {
        if (path === '/api/v3/qualityprofile') {
          return Promise.resolve([
            {
              id: 1,
              name: 'HD',
              formatItems: [],
              cutoffFormatScore: 99,
            },
          ]);
        }

        if (path === '/api/v3/series/22') {
          return Promise.resolve({
            id: 22,
            qualityProfileId: 1,
          });
        }

        if (path === '/api/v3/episode?seriesId=22') {
          return Promise.resolve([
            {
              id: 100,
              episodeNumber: 1,
              seasonNumber: 1,
              title: 'Pilot',
              hasFile: true,
              monitored: true,
              episodeFileId: 500,
            },
          ]);
        }

        if (path === '/api/v3/episodefile?seriesId=22') {
          return Promise.resolve([
            {
              id: 500,
              relativePath: 'S01E01.mkv',
              quality: {
                quality: {
                  name: 'WEB-DL 1080p',
                },
              },
              customFormats: [],
              customFormatScore: 12,
              size: 1024,
              qualityCutoffNotMet: false,
            },
          ]);
        }

        throw new Error(`Unexpected Arr client path: ${path}`);
      }) as typeof SonarrClient.prototype.get,
      this.restoreStack
    );
  }

  private createUrl(path: string): URL {
    return new URL(`http://localhost${path}`);
  }

  private runLayoutRedactionTest(): void {
    this.test('arr settings layout payload omits plaintext api_key', async () => {
      const instance = this.makeInstanceFixture(501);
      this.installPatch(arrInstancesQueries, 'getById', () => instance, this.restoreStack);

      const layout = (await arrLayoutLoad({
        params: {
          id: String(instance.id),
        },
      } as unknown as Parameters<ArrLayoutLoad>[0])) as { instance: Record<string, unknown> };

      this.assertPayloadNoLeak(layout, SECRET_API_KEY, 'settings page load payload');
      assertFalse(
        'api_key' in (layout.instance as Record<string, unknown>),
        'settings payload should not include api_key'
      );
      assertEquals(layout.instance.id, instance.id);
    });
  }

  private runEpisodesRouteRedactionTest(): void {
    this.test('arr library episodes endpoint omits plaintext api_key', async () => {
      const instance = this.makeInstanceFixture(502);
      this.patchArrCredentialDecryptor();
      this.patchSonarrClientGet();
      this.installPatch(arrInstancesQueries, 'getById', () => instance, this.restoreStack);
      const credentials = this.makeInstanceCredentialFixture(instance.id);
      this.installPatch(arrInstanceCredentialsQueries, 'getByInstanceId', () => credentials, this.restoreStack);

      const response = await libraryEpisodesGet({
        url: this.createUrl('/api/v1/arr/library/episodes?instanceId=502&seriesId=22'),
      } as unknown as Parameters<LibraryEpisodesGet>[0]);
      assertEquals(response.status, 200);

      const text = await response.text();
      this.assertPayloadNoLeak(text, SECRET_API_KEY, 'episodes API payload');

      const payload = JSON.parse(text) as { episodes: Array<Record<string, unknown>> };
      assertEquals(Array.isArray(payload.episodes), true);
      for (const episode of payload.episodes) {
        assertFalse('api_key' in episode);
      }
    });
  }

  private runGeneralSettingsLoadRedactionShortKeyTest(): void {
    this.test('settings/general payload omits short plaintext keys', async () => {
      const tmdbKey = 'shortTmdb';
      const aiKey = 'shortAI';

      this.patchGeneralSettingsLoadDependencies(tmdbKey, aiKey);

      const payload = (await settingsGeneralLoad()) as {
        aiSettings: {
          api_key_masked: string;
          has_api_key: boolean;
        };
        tmdbSettings: {
          api_key_masked: string;
          has_api_key: boolean;
        };
      };

      this.assertPayloadNoLeak(payload, tmdbKey, 'general settings load payload');
      this.assertPayloadNoLeak(payload, aiKey, 'general settings load payload');
      assertEquals(payload.tmdbSettings.api_key_masked, maskApiKey(tmdbKey));
      assertEquals(payload.aiSettings.api_key_masked, maskApiKey(aiKey));
      assertEquals(payload.tmdbSettings.has_api_key, true);
      assertEquals(payload.aiSettings.has_api_key, true);
      assertFalse('api_key' in payload.tmdbSettings);
      assertFalse('api_key' in payload.aiSettings);
    });
  }

  private runGeneralSettingsLoadRedactionEmptyKeyTest(): void {
    this.test('settings/general payload omits empty plaintext keys', async () => {
      const tmdbKey = '';
      const aiKey = '';

      this.patchGeneralSettingsLoadDependencies(tmdbKey, aiKey);

      const payload = (await settingsGeneralLoad()) as {
        aiSettings: {
          api_key_masked: string;
          has_api_key: boolean;
        };
        tmdbSettings: {
          api_key_masked: string;
          has_api_key: boolean;
        };
      };

      assertEquals(payload.tmdbSettings.api_key_masked, '');
      assertEquals(payload.aiSettings.api_key_masked, '');
      assertEquals(payload.tmdbSettings.has_api_key, false);
      assertEquals(payload.aiSettings.has_api_key, false);
      assertFalse('api_key' in payload.tmdbSettings);
      assertFalse('api_key' in payload.aiSettings);
    });
  }

  private runSecuritySettingsLoadRedactionShortKeyTest(): void {
    this.test('settings/security payload omits short plaintext api_key', async () => {
      const apiKey = 'shortAuth';
      this.patchSecuritySettingsLoadDependencies(apiKey);

      const payload = (await settingsSecurityLoad({
        cookies: {
          get: () => null,
        },
      } as unknown as Parameters<typeof settingsSecurityLoad>[0])) as {
        apiKeyMasked: string;
        hasApiKey: boolean;
      };

      this.assertPayloadNoLeak(payload, apiKey, 'security settings load payload');
      assertEquals(payload.apiKeyMasked, maskApiKey(apiKey));
      assertEquals(payload.hasApiKey, true);
      assertFalse('api_key' in payload);
    });
  }

  private runSecuritySettingsLoadRedactionEmptyKeyTest(): void {
    this.test('settings/security payload omits empty api_key', async () => {
      const apiKey = '';
      this.patchSecuritySettingsLoadDependencies(apiKey);

      const payload = (await settingsSecurityLoad({
        cookies: {
          get: () => null,
        },
      } as unknown as Parameters<typeof settingsSecurityLoad>[0])) as {
        apiKeyMasked: string;
        hasApiKey: boolean;
      };

      assertEquals(payload.apiKeyMasked, '');
      assertEquals(payload.hasApiKey, false);
      assertFalse('api_key' in payload);
    });
  }

  override run(): Promise<void> {
    this.runLayoutRedactionTest();
    this.runEpisodesRouteRedactionTest();
    this.runGeneralSettingsLoadRedactionShortKeyTest();
    this.runGeneralSettingsLoadRedactionEmptyKeyTest();
    this.runSecuritySettingsLoadRedactionShortKeyTest();
    this.runSecuritySettingsLoadRedactionEmptyKeyTest();
    return Promise.resolve();
  }
}

const test = new ArrCredentialRedactionRoutesTest();
await test.run();
