import { assertEquals, assertFalse } from '@std/assert';
import type { TestContext } from './BaseTest.ts';
import { BaseTest } from './BaseTest.ts';
import { arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '../../lib/server/db/queries/arrInstanceCredentials.ts';
import { config } from '../../lib/server/utils/config/config.ts';
import type { ArrInstanceCredential } from '../../lib/server/db/queries/arrInstanceCredentials.ts';
import type { ArrInstance } from '../../lib/server/db/queries/arrInstances.ts';
import { SonarrClient } from '../../lib/server/utils/arr/clients/sonarr.ts';
import { load as arrLayoutLoad } from '../../routes/arr/[id]/+layout.server.ts';
import { GET as libraryEpisodesGet } from '../../routes/api/v1/arr/library/episodes/+server.ts';

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
      assertFalse('api_key' in (layout.instance as Record<string, unknown>), 'settings payload should not include api_key');
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

  override run(): Promise<void> {
    this.runLayoutRedactionTest();
    this.runEpisodesRouteRedactionTest();
    return Promise.resolve();
  }
}

const test = new ArrCredentialRedactionRoutesTest();
await test.run();
