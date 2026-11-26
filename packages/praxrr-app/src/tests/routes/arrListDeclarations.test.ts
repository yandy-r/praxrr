// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assertEquals } from '@std/assert';
import { arrInstancesQueries, type ArrInstance, type ArrInstanceSource } from '$db/queries/arrInstances.ts';
import { deriveArrInstanceApiKeyFingerprint } from '$server/utils/encryption/arr-credentials.ts';
import { load } from '../../routes/arr/+page.server.ts';

type LoadEvent = Parameters<typeof load>[0];
type ListInstance = ArrInstance & {
  source: ArrInstanceSource;
  isEnvManaged: boolean;
  canDelete: boolean;
};

interface Fixture {
  rows: ArrInstance[];
  env: Record<string, string>;
  uiByName?: Record<string, ArrInstance>;
  failLookup?: boolean;
}

const DECLARED_ENV = {
  RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
  RADARR_INSTANCE_API_KEY_1: 'declared-key',
  RADARR_INSTANCE_NAME_1: 'Declared Radarr',
};

let nextInstanceId = 1;

function makeInstance(
  name: string,
  options: { source?: ArrInstanceSource; fingerprint?: string | null; type?: string } = {}
): ArrInstance {
  return {
    id: nextInstanceId++,
    name,
    type: options.type ?? 'radarr',
    url: 'http://127.0.0.1:9',
    external_url: null,
    api_key_fingerprint: options.fingerprint ?? null,
    api_key: 'synthetic-api-key',
    tags: null,
    enabled: 1,
    source: options.source ?? 'env',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

async function withListFixture(
  fixture: Fixture,
  test: (context: { loadList: () => Promise<ListInstance[]>; envSnapshots: () => number }) => Promise<void>
): Promise<void> {
  const originalToObject = Deno.env.toObject;
  const originalQueries = {
    getAll: arrInstancesQueries.getAll,
    getBySourceAndName: arrInstancesQueries.getBySourceAndName,
    getByApiKey: arrInstancesQueries.getByApiKey,
  };
  let envSnapshots = 0;

  Deno.env.toObject = () => {
    envSnapshots += 1;
    return { ...fixture.env };
  };
  arrInstancesQueries.getAll = () => fixture.rows;
  arrInstancesQueries.getBySourceAndName = (source, name) => {
    if (fixture.failLookup) throw new Error('synthetic declaration lookup failure');
    return source === 'ui' ? fixture.uiByName?.[name] : undefined;
  };
  arrInstancesQueries.getByApiKey = () => undefined;

  const loadList = async (): Promise<ListInstance[]> => {
    const result = (await load({} as LoadEvent)) as { instances: ListInstance[] };
    return result.instances;
  };

  try {
    await test({ loadList, envSnapshots: () => envSnapshots });
  } finally {
    Deno.env.toObject = originalToObject;
    Object.assign(arrInstancesQueries, originalQueries);
  }
}

function deleteFlags(instances: ListInstance[]): { name: string; canDelete: boolean }[] {
  return instances.map(({ name, canDelete }) => ({ name, canDelete }));
}

Deno.test(
  '/arr load evaluates declarations once for several env rows and refreshes them on the next load',
  async () => {
    const declaredFingerprint = (await deriveArrInstanceApiKeyFingerprint(DECLARED_ENV.RADARR_INSTANCE_API_KEY_1))
      .value;
    const fixture: Fixture = {
      env: { ...DECLARED_ENV },
      rows: [
        makeInstance('Declared Radarr'),
        makeInstance('Renamed Radarr', { fingerprint: declaredFingerprint }),
        makeInstance('Removed Radarr', { fingerprint: 'unmatched-fingerprint' }),
      ],
    };

    await withListFixture(fixture, async ({ loadList, envSnapshots }) => {
      const first = await loadList();
      assertEquals(envSnapshots(), 1);
      assertEquals(deleteFlags(first), [
        { name: 'Declared Radarr', canDelete: false },
        { name: 'Renamed Radarr', canDelete: false },
        { name: 'Removed Radarr', canDelete: true },
      ]);

      fixture.env = {};

      const second = await loadList();
      assertEquals(envSnapshots(), 2);
      assertEquals(
        second.map((instance) => instance.canDelete),
        [true, true, true]
      );
    });
  }
);

Deno.test('/arr load does not evaluate env declarations for a UI-only list', async () => {
  const fixture: Fixture = {
    env: { ...DECLARED_ENV },
    rows: [makeInstance('UI Radarr', { source: 'ui' }), makeInstance('UI Sonarr', { source: 'ui', type: 'sonarr' })],
  };

  await withListFixture(fixture, async ({ loadList, envSnapshots }) => {
    const instances = await loadList();

    assertEquals(envSnapshots(), 0);
    assertEquals(
      instances.map(({ canDelete, isEnvManaged }) => ({ canDelete, isEnvManaged })),
      [
        { canDelete: true, isEnvManaged: false },
        { canDelete: true, isEnvManaged: false },
      ]
    );
  });
});

Deno.test('/arr load keeps duplicate and UI-conflicting env descriptors undeclared (#475)', async () => {
  const sharedFingerprint = (await deriveArrInstanceApiKeyFingerprint('shared-conflict-key')).value;
  const uiConflict = makeInstance('UI-Managed Radarr', { source: 'ui', fingerprint: 'ui-fingerprint' });
  const fixture: Fixture = {
    env: {
      RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
      RADARR_INSTANCE_API_KEY_1: 'shared-conflict-key',
      RADARR_INSTANCE_NAME_1: 'UI-Managed Radarr',
      SONARR_INSTANCE_URL_1: 'http://sonarr.local:8989',
      SONARR_INSTANCE_API_KEY_1: 'shared-conflict-key',
      SONARR_INSTANCE_NAME_1: 'Duplicate Sonarr',
    },
    rows: [
      makeInstance('UI-Managed Radarr'),
      makeInstance('Old Env Radarr', { fingerprint: sharedFingerprint }),
      makeInstance('Duplicate Sonarr', { type: 'sonarr' }),
    ],
    uiByName: { [uiConflict.name]: uiConflict },
  };

  await withListFixture(fixture, async ({ loadList, envSnapshots }) => {
    const instances = await loadList();

    assertEquals(envSnapshots(), 1);
    assertEquals(
      instances.map((instance) => instance.canDelete),
      [true, true, true]
    );
  });
});

Deno.test('/arr load fails closed when declaration evaluation fails and recovers on a later load', async () => {
  const fixture: Fixture = {
    env: { ...DECLARED_ENV },
    rows: [
      makeInstance('Gone Radarr'),
      makeInstance('Gone Sonarr', { type: 'sonarr' }),
      makeInstance('UI Radarr', { source: 'ui' }),
    ],
    failLookup: true,
  };

  await withListFixture(fixture, async ({ loadList, envSnapshots }) => {
    const failed = await loadList();
    assertEquals(envSnapshots(), 1);
    assertEquals(
      failed.map((instance) => instance.canDelete),
      [false, false, true]
    );

    fixture.failLookup = false;
    const recovered = await loadList();
    assertEquals(envSnapshots(), 2);
    assertEquals(
      recovered.map((instance) => instance.canDelete),
      [true, true, true]
    );
  });
});
