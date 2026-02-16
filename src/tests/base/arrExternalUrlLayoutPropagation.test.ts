import { assertEquals } from '@std/assert';
import { arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import { load as arrLayoutLoad } from '../../routes/arr/[id]/+layout.server.ts';
import { actions as settingsActions } from '../../routes/arr/[id]/settings/+page.server.ts';
import type { ArrInstance, UpdateArrInstanceInput } from '../../lib/server/db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';

type Restore = () => void;
type LayoutLoad = typeof arrLayoutLoad;
type SettingsUpdate = typeof settingsActions.update;

interface ArrLayoutData {
  instance: ArrInstance;
}

function installPatch<T extends object, K extends keyof T>(
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

function createSettingsRequest(id: number, fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }

  return new Request(`http://localhost/arr/${id}/settings`, {
    method: 'POST',
    body: formData,
  });
}

Deno.test('arr layout load reflects updated external_url after settings action rerun', async () => {
  const restores: Restore[] = [];
  const instance: ArrInstance = {
    id: 44,
    name: 'Original',
    type: 'lidarr',
    url: 'http://arr.internal',
    external_url: null,
    api_key: 'old-key',
    tags: null,
    enabled: 1,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  };

  let layoutLoadCalls = 0;
  let updateCalls = 0;
  let nameExistsCalls = 0;
  let apiKeyExistsCalls = 0;

  try {
    installPatch(
      arrInstancesQueries,
      'getById',
      (id) => {
        layoutLoadCalls++;
        return id === instance.id ? { ...instance } : undefined;
      },
      restores
    );

    installPatch(
      arrInstancesQueries,
      'update',
      (id, payload: UpdateArrInstanceInput) => {
        if (id !== instance.id) {
          return false;
        }

        updateCalls++;
        if (payload.name !== undefined) {
          instance.name = payload.name;
        }

        if (payload.url !== undefined) {
          instance.url = payload.url;
        }

        if (payload.apiKey !== undefined) {
          instance.api_key = payload.apiKey;
        }

        if (payload.externalUrl !== undefined) {
          instance.external_url = payload.externalUrl;
        }

        if (payload.tags !== undefined) {
          instance.tags = payload.tags.length > 0 ? JSON.stringify(payload.tags) : null;
        }

        if (payload.enabled !== undefined) {
          instance.enabled = payload.enabled ? 1 : 0;
        }

        return true;
      },
      restores
    );

    installPatch(
      arrInstancesQueries,
      'nameExists',
      () => {
        nameExistsCalls++;
        return false;
      },
      restores
    );

    installPatch(
      arrInstancesQueries,
      'apiKeyExists',
      () => {
        apiKeyExistsCalls++;
        return false;
      },
      restores
    );

    installPatch(logger, 'info', async () => {}, restores);

    const load = async () =>
      (await arrLayoutLoad({
        params: { id: String(instance.id) },
      } as unknown as Parameters<LayoutLoad>[0])) as ArrLayoutData;

    const beforeAction = await load();
    assertEquals(beforeAction.instance.external_url, null);

    const actionResult = await settingsActions.update({
      params: { id: String(instance.id) },
      request: createSettingsRequest(instance.id, {
        name: 'Updated Instance',
        url: 'http://arr.internal',
        api_key: 'updated-key',
        external_url: 'https://arr.example.com',
      }),
    } as unknown as Parameters<SettingsUpdate>[0]);

    assertEquals(actionResult, { success: true });
    assertEquals(updateCalls, 1);
    assertEquals(nameExistsCalls, 1);
    assertEquals(apiKeyExistsCalls, 1);

    // Simulate the post-action load invalidation path instead of relying on cached client state.
    const afterAction = await load();
    assertEquals(afterAction.instance.external_url, 'https://arr.example.com');
    assertEquals(layoutLoadCalls, 3);
    assertEquals(beforeAction.instance.external_url, null);
    assertEquals(afterAction.instance.external_url, 'https://arr.example.com');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
