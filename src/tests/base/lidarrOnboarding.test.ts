import { assertEquals } from '@std/assert';
import { isRedirect } from '@sveltejs/kit';
import { BaseTest, type TestContext } from './BaseTest.ts';
import { actions } from '../../routes/arr/new/+page.server.ts';
import { POST as testConnectionPost } from '../../routes/arr/test/+server.ts';
import { arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
interface CapturedCreate {
  type: string;
  name: string;
  apiKey: string;
  tags?: string[];
  enabled?: boolean;
}
import { generalSettingsQueries } from '../../lib/server/db/queries/generalSettings.ts';
import { LidarrClient } from '../../lib/server/utils/arr/clients/lidarr.ts';

type Restore = () => void;
type NewInstanceAction = (typeof actions)['default'];
type TestConnectionPayload = { success: boolean; error?: string };

class LidarrOnboardingTest extends BaseTest {
  private restores: Restore[] = [];

  protected override beforeEach(_context: TestContext): void {
    this.restores = [];
  }

  protected override afterEach(_context: TestContext): void {
    for (const restore of this.restores.reverse()) {
      restore();
    }
  }

  private patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;

    this.restores.push(() => {
      target[key] = original;
    });
  }

  private createFormRequest(fields: Record<string, string>): Request {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }

    return new Request('http://localhost/arr/new', {
      method: 'POST',
      body: formData,
    });
  }

  private createJsonRequest(payload: Record<string, string>): Request {
    return new Request('http://localhost/arr/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  runTests(): void {
    this.test('arr/new rejects unsupported type with existing failure envelope', async () => {
      const request = this.createFormRequest({
        name: 'Invalid Instance',
        type: 'chaptarr',
        url: 'http://arr.local',
        api_key: 'invalid-key',
      });

      const result = await actions.default({ request } as Parameters<NewInstanceAction>[0]);
      const failure = result as { status: number; data: { error: string } };

      assertEquals(failure.status, 400);
      assertEquals(failure.data.error, 'Invalid arr type');
    });

    this.test('arr/new accepts lidarr and redirects after create', async () => {
      let created: CapturedCreate | null = null;
      let delayProfileChecks = 0;

      const nameExistsMock: typeof arrInstancesQueries.nameExists = () => false;
      const apiKeyExistsMock: typeof arrInstancesQueries.apiKeyExists = () => false;
      const createMock: typeof arrInstancesQueries.create = (input) => {
        created = input;
        return 77;
      };
      const shouldApplyDefaultDelayProfilesMock: typeof generalSettingsQueries.shouldApplyDefaultDelayProfiles = () => {
        delayProfileChecks++;
        return true;
      };

      this.patch(arrInstancesQueries, 'nameExists', nameExistsMock);
      this.patch(arrInstancesQueries, 'apiKeyExists', apiKeyExistsMock);
      this.patch(arrInstancesQueries, 'create', createMock);
      this.patch(generalSettingsQueries, 'shouldApplyDefaultDelayProfiles', shouldApplyDefaultDelayProfilesMock);

      const request = this.createFormRequest({
        name: 'Lidarr Main',
        type: 'lidarr',
        url: 'http://lidarr.local',
        api_key: 'lidarr-api-key',
        tags: JSON.stringify(['music']),
        enabled: '1',
      });

      try {
        await actions.default({ request } as Parameters<NewInstanceAction>[0]);
        throw new Error('Expected redirect from successful onboarding action');
      } catch (error) {
        if (!isRedirect(error)) {
          throw error;
        }

        assertEquals(error.status, 303);
        assertEquals(error.location, '/arr/77/settings');
      }

      const c = created as unknown as CapturedCreate;
      assertEquals(c.type, 'lidarr');
      assertEquals(c.name, 'Lidarr Main');
      assertEquals(c.apiKey, 'lidarr-api-key');
      assertEquals(c.tags, ['music']);
      assertEquals(c.enabled, true);
      assertEquals(delayProfileChecks, 0);
    });

    this.test('arr/test rejects unsupported types', async () => {
      const response = await testConnectionPost({
        request: this.createJsonRequest({
          type: 'chaptarr',
          url: 'http://arr.local',
          apiKey: 'invalid-key',
        }),
      } as Parameters<typeof testConnectionPost>[0]);

      const payload = (await response.json()) as TestConnectionPayload;

      assertEquals(response.status, 400);
      assertEquals(payload, {
        success: false,
        error: 'Invalid arr type',
      });
    });

    this.test('arr/test accepts lidarr and uses existing response envelope', async () => {
      let testConnectionCalls = 0;
      let closeCalls = 0;

      const testConnectionMock: typeof LidarrClient.prototype.testConnection = async () => {
        testConnectionCalls++;
        return true;
      };
      const originalClose = LidarrClient.prototype.close;
      const closeMock: typeof LidarrClient.prototype.close = function (this: LidarrClient) {
        closeCalls++;
        originalClose.call(this);
      };

      this.patch(LidarrClient.prototype, 'testConnection', testConnectionMock);
      this.patch(LidarrClient.prototype, 'close', closeMock);

      const response = await testConnectionPost({
        request: this.createJsonRequest({
          type: 'lidarr',
          url: 'http://lidarr.local',
          apiKey: 'lidarr-api-key',
        }),
      } as Parameters<typeof testConnectionPost>[0]);

      const payload = (await response.json()) as TestConnectionPayload;

      assertEquals(response.status, 200);
      assertEquals(payload, { success: true });
      assertEquals(testConnectionCalls, 1);
      assertEquals(closeCalls, 1);
    });
  }
}

const test = new LidarrOnboardingTest();
await test.runTests();
