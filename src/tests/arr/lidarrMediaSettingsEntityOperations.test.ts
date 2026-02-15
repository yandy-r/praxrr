import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { isRedirect } from '@sveltejs/kit';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { PCDCache as RuntimePCDCache } from '$pcd/database/cache.ts';
import { deleteCache, getCache, setCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { createLidarrMediaSettings } from '$pcd/entities/mediaManagement/media-settings/create.ts';
import {
  getLidarrByName,
  getSonarrByName,
  list as listMediaSettings,
} from '$pcd/entities/mediaManagement/media-settings/read.ts';
import { updateLidarrMediaSettings } from '$pcd/entities/mediaManagement/media-settings/update.ts';
import { POST as importPortablePost } from '../../routes/api/v1/pcd/import/+server.ts';
import { GET as exportPortableGet } from '../../routes/api/v1/pcd/export/+server.ts';
import { actions as lidarrMediaSettingsActions } from '../../routes/media-management/[databaseId]/media-settings/lidarr/[name]/+page.server.ts';

const DATABASE_ID = 2202;

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

interface WriteHarness {
  cache: RuntimePCDCache;
  operations: PcdOp[];
  cleanup: () => Promise<void>;
}

function createCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(schemaAndDataSql);

  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function baseMediaSettingsSchema(extraInserts = ''): string {
  return `
CREATE TABLE IF NOT EXISTS radarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sonarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

${extraInserts}
`;
}

async function createWriteHarness(schemaSql: string): Promise<WriteHarness> {
  const tempPath = `/tmp/profilarr-tests/lidarr-media-settings-entity-${crypto.randomUUID()}`;
  await Deno.mkdir(`${tempPath}/deps/schema/ops`, { recursive: true });
  await Deno.writeTextFile(`${tempPath}/deps/schema/ops/0.schema.sql`, schemaSql);

  const operations: PcdOp[] = [];
  const restores: Array<() => void> = [];
  let nextOpId = 1;

  function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    restores.push(() => {
      target[key] = original;
    });
  }

  const now = new Date().toISOString();
  patch(databaseInstancesQueries, 'getById', (id: number) => {
    if (id !== DATABASE_ID) {
      return undefined;
    }

    return {
      id,
      uuid: 'lidarr-media-settings-entity-ops',
      name: 'lidarr-media-settings-entity-ops',
      repository_url: 'file:///tmp/lidarr-media-settings-entity-ops',
      local_path: tempPath,
      sync_strategy: 0,
      auto_pull: 1,
      enabled: 1,
      personal_access_token: 'token',
      is_private: 0,
      local_ops_enabled: 0,
      git_user_name: null,
      git_user_email: null,
      conflict_strategy: 'override',
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    };
  });

  patch(pcdOpsQueries, 'create', (input) => {
    const opNow = new Date().toISOString();
    const record: PcdOp = {
      id: nextOpId++,
      database_id: input.databaseId,
      origin: input.origin,
      state: input.state,
      source: input.source,
      filename: input.filename ?? null,
      op_number: input.opNumber ?? null,
      sequence: input.sequence ?? null,
      sql: input.sql,
      metadata: input.metadata ?? null,
      desired_state: input.desiredState ?? null,
      content_hash: input.contentHash ?? null,
      last_seen_in_repo_at: input.lastSeenInRepoAt ?? null,
      superseded_by_op_id: input.supersededByOpId ?? null,
      pushed_at: input.pushedAt ?? null,
      pushed_commit: input.pushedCommit ?? null,
      created_at: opNow,
      updated_at: opNow,
    };
    operations.push(record);
    return record.id;
  });

  patch(pcdOpsQueries, 'listByDatabase', (databaseId: number) =>
    operations.filter((operation) => operation.database_id === databaseId).sort((a, b) => a.id - b.id)
  );

  patch(pcdOpsQueries, 'listByDatabaseAndOrigin', (databaseId, origin, options) => {
    const queryOptions = options ?? {};
    let rows = operations.filter((operation) => operation.database_id === databaseId && operation.origin === origin);

    if (queryOptions.states && queryOptions.states.length > 0) {
      rows = rows.filter((row) => queryOptions.states?.includes(row.state));
    }

    if (queryOptions.source) {
      rows = rows.filter((row) => row.source === queryOptions.source);
    }

    return rows.sort((a, b) => a.id - b.id);
  });

  patch(pcdOpsQueries, 'update', (id, update) => {
    const row = operations.find((operation) => operation.id === id);
    if (!row) {
      return false;
    }

    if (update.state !== undefined) {
      row.state = update.state;
    }
    if (update.metadata !== undefined) {
      row.metadata = update.metadata;
    }
    if (update.desiredState !== undefined) {
      row.desired_state = update.desiredState;
    }
    return true;
  });

  let nextHistoryId = 1;
  patch(pcdOpHistoryQueries, 'create', () => nextHistoryId++);
  patch(pcdOpHistoryQueries, 'listLatestConflictsByDatabase', () => []);
  patch(pcdOpHistoryQueries, 'listLatestByDatabaseWithOps', () => []);
  patch(pcdOpHistoryQueries, 'listByDatabase', () => []);
  patch(pcdOpHistoryQueries, 'listByOp', () => []);

  const cache = new RuntimePCDCache(tempPath, DATABASE_ID);
  await cache.build();
  setCache(DATABASE_ID, cache);

  return {
    cache,
    operations,
    cleanup: async () => {
      for (const restore of restores.reverse()) {
        restore();
      }

      const cached = getCache(DATABASE_ID);
      if (cached) {
        cached.close();
      }
      deleteCache(DATABASE_ID);

      await Deno.remove(tempPath, { recursive: true });
    },
  };
}

Deno.test('lidarr media-settings read/list use dedicated lidarr storage only', async () => {
  const fixture = createCacheFixture(
    baseMediaSettingsSchema(`
INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Shared-Name', 'doNotPrefer', 1);

INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Lidarr-Only', 'preferAndUpgrade', 0);
`)
  );

  try {
    const items = await listMediaSettings(fixture.cache);
    const lidarrNames = items.filter((item) => item.arr_type === 'lidarr').map((item) => item.name);
    assertEquals(lidarrNames, ['Lidarr-Only']);

    const lidarrOnly = await getLidarrByName(fixture.cache, 'Lidarr-Only');
    assertExists(lidarrOnly);
    assertEquals(lidarrOnly.propers_repacks, 'preferAndUpgrade');
    assertEquals(lidarrOnly.enable_media_info, false);

    const sharedName = await getLidarrByName(fixture.cache, 'Shared-Name');
    assertEquals(sharedName, null);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('createLidarrMediaSettings writes to lidarr_media_settings and keeps metadata identity', async () => {
  const harness = await createWriteHarness(
    baseMediaSettingsSchema(`
INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Cross-App-Shared', 'doNotPrefer', 1);
`)
  );

  try {
    const result = await createLidarrMediaSettings({
      databaseId: DATABASE_ID,
      cache: harness.cache,
      layer: 'user',
      input: {
        name: 'Cross-App-Shared',
        propersRepacks: 'preferAndUpgrade',
        enableMediaInfo: true,
      },
    });

    assertEquals(result.success, true);
    assertEquals(harness.operations.length, 1);

    const createdMetadata = JSON.parse(harness.operations[0].metadata ?? '{}') as {
      entity?: string;
      stable_key?: { key?: string; value?: string };
    };
    assertEquals(createdMetadata.entity, 'lidarr_media_settings');
    assertEquals(createdMetadata.stable_key?.key, 'lidarr_media_settings_name');
    assertEquals(createdMetadata.stable_key?.value, 'Cross-App-Shared');
    assertEquals(harness.operations[0].sql.includes('lidarr_media_settings'), true);

    const compiledCache = getCache(DATABASE_ID);
    assertExists(compiledCache);

    const lidarrCreated = await getLidarrByName(compiledCache, 'Cross-App-Shared');
    assertExists(lidarrCreated);
    assertEquals(lidarrCreated.propers_repacks, 'preferAndUpgrade');
    assertEquals(lidarrCreated.enable_media_info, true);

    const sonarrUnchanged = await getSonarrByName(compiledCache, 'Cross-App-Shared');
    assertExists(sonarrUnchanged);
    assertEquals(sonarrUnchanged.propers_repacks, 'doNotPrefer');
  } finally {
    await harness.cleanup();
  }
});

Deno.test('createLidarrMediaSettings duplicate name fails deterministically', async () => {
  const fixture = createCacheFixture(
    baseMediaSettingsSchema(`
INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Duplicate-Name', 'doNotPrefer', 1);
`)
  );

  try {
    await assertRejects(
      () =>
        createLidarrMediaSettings({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          input: {
            name: 'Duplicate-Name',
            propersRepacks: 'preferAndUpgrade',
            enableMediaInfo: false,
          },
        }),
      Error,
      'A lidarr media settings config with name "Duplicate-Name" already exists'
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test('updateLidarrMediaSettings updates lidarr row and preserves lidarr metadata identity', async () => {
  const harness = await createWriteHarness(
    baseMediaSettingsSchema(`
INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Lidarr-Old', 'doNotPrefer', 0);
`)
  );

  try {
    const current = await getLidarrByName(harness.cache, 'Lidarr-Old');
    assertExists(current);

    const result = await updateLidarrMediaSettings({
      databaseId: DATABASE_ID,
      cache: harness.cache,
      layer: 'user',
      current,
      input: {
        name: 'Lidarr-New',
        propersRepacks: 'preferAndUpgrade',
        enableMediaInfo: true,
      },
    });

    assertEquals(result.success, true);
    assertEquals(harness.operations.length, 1);

    const updateMetadata = JSON.parse(harness.operations[0].metadata ?? '{}') as {
      entity?: string;
      stable_key?: { key?: string; value?: string };
      changed_fields?: string[];
      previousName?: string;
    };
    assertEquals(updateMetadata.entity, 'lidarr_media_settings');
    assertEquals(updateMetadata.stable_key?.key, 'lidarr_media_settings_name');
    assertEquals(updateMetadata.stable_key?.value, 'Lidarr-Old');
    assertEquals(updateMetadata.previousName, 'Lidarr-Old');
    assertEquals(updateMetadata.changed_fields, ['name', 'propersRepacks', 'enableMediaInfo']);
    assertEquals(harness.operations[0].sql.includes('lidarr_media_settings'), true);

    const compiledCache = getCache(DATABASE_ID);
    assertExists(compiledCache);

    const renamed = await getLidarrByName(compiledCache, 'Lidarr-New');
    assertExists(renamed);
    assertEquals(renamed.propers_repacks, 'preferAndUpgrade');
    assertEquals(renamed.enable_media_info, true);

    const old = await getLidarrByName(compiledCache, 'Lidarr-Old');
    assertEquals(old, null);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('updateLidarrMediaSettings duplicate rename fails deterministically', async () => {
  const fixture = createCacheFixture(
    baseMediaSettingsSchema(`
INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Config-A', 'doNotPrefer', 1);

INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Config-B', 'preferAndUpgrade', 0);
`)
  );

  try {
    const current = await getLidarrByName(fixture.cache, 'Config-A');
    assertExists(current);

    await assertRejects(
      () =>
        updateLidarrMediaSettings({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          current,
          input: {
            name: 'Config-B',
            propersRepacks: current.propers_repacks,
            enableMediaInfo: current.enable_media_info,
          },
        }),
      Error,
      'A lidarr media settings config with name "Config-B" already exists'
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test('portable import for lidarr_media_settings writes to lidarr table', async () => {
  const harness = await createWriteHarness(
    baseMediaSettingsSchema(`
INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Portable-Import', 'doNotPrefer', 1);
`)
  );

  try {
    const request = new Request('http://localhost/api/v1/pcd/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        databaseId: DATABASE_ID,
        layer: 'user',
        entityType: 'lidarr_media_settings',
        data: {
          name: 'Portable-Import',
          propersRepacks: 'preferAndUpgrade',
          enableMediaInfo: true,
        },
      }),
    });

    const response = await importPortablePost({
      request,
    } as unknown as Parameters<typeof importPortablePost>[0]);

    assertEquals(response.status, 200);
    const payload = (await response.json()) as { success?: boolean };
    assertEquals(payload.success, true);

    const compiledCache = getCache(DATABASE_ID);
    assertExists(compiledCache);

    const lidarrRow = await getLidarrByName(compiledCache, 'Portable-Import');
    assertExists(lidarrRow);
    assertEquals(lidarrRow.propers_repacks, 'preferAndUpgrade');
    assertEquals(lidarrRow.enable_media_info, true);

    const sonarrRow = await getSonarrByName(compiledCache, 'Portable-Import');
    assertExists(sonarrRow);
    assertEquals(sonarrRow.propers_repacks, 'doNotPrefer');
  } finally {
    await harness.cleanup();
  }
});

Deno.test('portable export for lidarr_media_settings reads from lidarr table', async () => {
  const harness = await createWriteHarness(
    baseMediaSettingsSchema(`
INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Portable-Export', 'preferAndUpgrade', 1);
`)
  );

  try {
    const url = new URL('http://localhost/api/v1/pcd/export');
    url.searchParams.set('databaseId', String(DATABASE_ID));
    url.searchParams.set('entityType', 'lidarr_media_settings');
    url.searchParams.set('name', 'Portable-Export');

    const response = await exportPortableGet({
      url,
    } as unknown as Parameters<typeof exportPortableGet>[0]);

    assertEquals(response.status, 200);

    const payload = (await response.json()) as {
      entityType: string;
      data: { name: string; propersRepacks: string; enableMediaInfo: boolean };
    };

    assertEquals(payload.entityType, 'lidarr_media_settings');
    assertEquals(payload.data.name, 'Portable-Export');
    assertEquals(payload.data.propersRepacks, 'preferAndUpgrade');
    assertEquals(payload.data.enableMediaInfo, true);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('lidarr media-settings delete action removes row from lidarr table', async () => {
  const harness = await createWriteHarness(
    baseMediaSettingsSchema(`
INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Delete-Me', 'preferAndUpgrade', 1);
`)
  );

  try {
    const formData = new FormData();
    formData.set('layer', 'user');
    const request = new Request('http://localhost/media-management/2202/media-settings/lidarr/Delete-Me', {
      method: 'POST',
      body: formData,
    });

    let redirected = false;
    try {
      await lidarrMediaSettingsActions.delete({
        request,
        params: {
          databaseId: String(DATABASE_ID),
          name: 'Delete-Me',
        },
      } as unknown as Parameters<typeof lidarrMediaSettingsActions.delete>[0]);
    } catch (error) {
      if (!isRedirect(error)) {
        throw error;
      }

      redirected = true;
      assertEquals(error.status, 303);
      assertEquals(error.location, `/media-management/${DATABASE_ID}/media-settings`);
    }
    assertEquals(redirected, true);

    const compiledCache = getCache(DATABASE_ID);
    assertExists(compiledCache);

    const deletedRow = await getLidarrByName(compiledCache, 'Delete-Me');
    assertEquals(deletedRow, null);
  } finally {
    await harness.cleanup();
  }
});
