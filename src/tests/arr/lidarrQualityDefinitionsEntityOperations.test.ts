import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { PCDCache as RuntimePCDCache } from '$pcd/database/cache.ts';
import { deleteCache, getCache, setCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { type PcdOp, pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { createLidarrQualityDefinitions } from '$pcd/entities/mediaManagement/quality-definitions/create.ts';
import {
  getLidarrByName,
  getSonarrByName,
  list as listQualityDefinitions,
} from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import { updateLidarrQualityDefinitions } from '$pcd/entities/mediaManagement/quality-definitions/update.ts';

const DATABASE_ID = 2203;

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

interface CacheFixtureWithDb extends CacheFixture {
  db: Database;
}

interface WriteHarness {
  cache: RuntimePCDCache;
  operations: PcdOp[];
  cleanup: () => Promise<void>;
}

interface QualityDefinitionsBadRequest extends Error {
  status?: number;
  code?: string;
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

function createCacheFixtureWithDb(schemaAndDataSql: string): CacheFixtureWithDb {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(schemaAndDataSql);

  return {
    cache: { kb } as unknown as PCDCache,
    db,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function baseQualityDefinitionsSchema(extraInserts = ''): string {
  return `
CREATE TABLE IF NOT EXISTS quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE IF NOT EXISTS radarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

CREATE TABLE IF NOT EXISTS sonarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

CREATE TABLE IF NOT EXISTS lidarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

${extraInserts}
`;
}

async function createWriteHarness(schemaSql: string): Promise<WriteHarness> {
  const tempPath = `/tmp/profilarr-tests/lidarr-quality-definitions-entity-${crypto.randomUUID()}`;
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
      uuid: 'lidarr-quality-definitions-entity-ops',
      name: 'lidarr-quality-definitions-entity-ops',
      repository_url: 'file:///tmp/lidarr-quality-definitions-entity-ops',
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

async function expectBadRequest(
  operation: () => Promise<unknown>,
  expectedMessage: string,
  expectedCode: string
): Promise<void> {
  let caught: unknown = null;

  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  assertExists(caught);
  assert(caught instanceof Error);

  const badRequest = caught as QualityDefinitionsBadRequest;
  assertEquals(badRequest.status, 400);
  assertEquals(badRequest.code, expectedCode);
  assertEquals(badRequest.message, expectedMessage);
}

Deno.test('lidarr quality-definitions read/list use dedicated lidarr storage with mapping filters', async () => {
  const fixture = createCacheFixture(
    baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
  ('FLAC', 'lidarr', 'FLAC'),
  ('Unknown', 'sonarr', 'Unknown'),
  ('Cinema', 'radarr', 'Bluray-1080p');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Shared-Name', 'Unknown', 0, 900, 300);

INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES
  ('Lidarr-Mixed', 'FLAC', 64, 1024, 320),
  ('Lidarr-Mixed', 'Legacy-Unmapped', 16, 400, 128);
`)
  );

  try {
    const listed = await listQualityDefinitions(fixture.cache);
    const lidarrItems = listed.filter((item) => item.arr_type === 'lidarr');

    assertEquals(lidarrItems.length, 1);
    assertEquals(lidarrItems[0].name, 'Lidarr-Mixed');
    assertEquals(lidarrItems[0].quality_count, 1);

    const lidarrConfig = await getLidarrByName(fixture.cache, 'Lidarr-Mixed');
    assertExists(lidarrConfig);
    assertEquals(lidarrConfig.entries.length, 1);
    assertEquals(lidarrConfig.entries[0].quality_name, 'FLAC');

    const sharedName = await getLidarrByName(fixture.cache, 'Shared-Name');
    assertEquals(sharedName, null);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('createLidarrQualityDefinitions writes to lidarr table and keeps lidarr metadata identity', async () => {
  const harness = await createWriteHarness(
    baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
  ('FLAC', 'lidarr', 'FLAC'),
  ('Unknown', 'sonarr', 'Unknown');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Cross-App-Shared', 'Unknown', 8, 80, 20);
`)
  );

  try {
    const result = await createLidarrQualityDefinitions({
      databaseId: DATABASE_ID,
      cache: harness.cache,
      layer: 'user',
      input: {
        name: 'Cross-App-Shared',
        entries: [
          {
            quality_name: 'FLAC',
            min_size: 64,
            max_size: 4096,
            preferred_size: 320,
          },
        ],
      },
    });

    assertEquals(result.success, true);
    assertEquals(harness.operations.length, 1);

    const createdMetadata = JSON.parse(harness.operations[0].metadata ?? '{}') as {
      entity?: string;
      stable_key?: { key?: string; value?: string };
    };
    assertEquals(createdMetadata.entity, 'lidarr_quality_definitions');
    assertEquals(createdMetadata.stable_key?.key, 'lidarr_quality_definitions_name');
    assertEquals(createdMetadata.stable_key?.value, 'Cross-App-Shared');
    assertEquals(harness.operations[0].sql.includes('lidarr_quality_definitions'), true);

    const compiledCache = getCache(DATABASE_ID);
    assertExists(compiledCache);

    const lidarrCreated = await getLidarrByName(compiledCache, 'Cross-App-Shared');
    assertExists(lidarrCreated);
    assertEquals(lidarrCreated.entries.length, 1);
    assertEquals(lidarrCreated.entries[0].quality_name, 'FLAC');

    const sonarrUnchanged = await getSonarrByName(compiledCache, 'Cross-App-Shared');
    assertExists(sonarrUnchanged);
    assertEquals(sonarrUnchanged.entries.length, 1);
    assertEquals(sonarrUnchanged.entries[0].quality_name, 'Unknown');
  } finally {
    await harness.cleanup();
  }
});

Deno.test('createLidarrQualityDefinitions duplicate name fails deterministically', async () => {
  const fixture = createCacheFixture(
    baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('FLAC', 'lidarr', 'FLAC');

INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Duplicate-Name', 'FLAC', 1, 2, 1);
`)
  );

  try {
    await assertRejects(
      () =>
        createLidarrQualityDefinitions({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          input: {
            name: 'Duplicate-Name',
            entries: [
              {
                quality_name: 'FLAC',
                min_size: 10,
                max_size: 20,
                preferred_size: 15,
              },
            ],
          },
        }),
      Error,
      'A lidarr quality definitions config with name "Duplicate-Name" already exists'
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test('createLidarrQualityDefinitions unmapped entries fail with explicit deterministic error', async () => {
  const fixture = createCacheFixture(
    baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('FLAC', 'lidarr', 'FLAC');
`)
  );

  try {
    await expectBadRequest(
      () =>
        createLidarrQualityDefinitions({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          input: {
            name: 'Unmapped-Create',
            entries: [
              {
                quality_name: 'Zulu',
                min_size: 1,
                max_size: 2,
                preferred_size: 1,
              },
              {
                quality_name: 'Alpha',
                min_size: 3,
                max_size: 4,
                preferred_size: 2,
              },
            ],
          },
        }),
      'Unsupported quality names for quality definitions for lidarr: Alpha, Zulu',
      'quality_definitions_unmapped'
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test('updateLidarrQualityDefinitions writes to lidarr table and replaces hidden unmapped rows', async () => {
  const harness = await createWriteHarness(
    baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
  ('FLAC', 'lidarr', 'FLAC'),
  ('AAC-192', 'lidarr', 'AAC-192');

INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES
  ('Lidarr-Old', 'FLAC', 64, 1024, 320),
  ('Lidarr-Old', 'Legacy-Unmapped', 16, 400, 128);
`)
  );

  try {
    const current = await getLidarrByName(harness.cache, 'Lidarr-Old');
    assertExists(current);
    assertEquals(current.entries.length, 1);

    const result = await updateLidarrQualityDefinitions({
      databaseId: DATABASE_ID,
      cache: harness.cache,
      layer: 'user',
      current,
      input: {
        name: 'Lidarr-New',
        entries: [
          {
            quality_name: 'AAC-192',
            min_size: 96,
            max_size: 1500,
            preferred_size: 320,
          },
        ],
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

    assertEquals(updateMetadata.entity, 'lidarr_quality_definitions');
    assertEquals(updateMetadata.stable_key?.key, 'lidarr_quality_definitions_name');
    assertEquals(updateMetadata.stable_key?.value, 'Lidarr-Old');
    assertEquals(updateMetadata.previousName, 'Lidarr-Old');
    assertEquals(updateMetadata.changed_fields, ['name', 'entries']);
    assertEquals(harness.operations[0].sql.includes('lidarr_quality_definitions'), true);

    const compiledCache = getCache(DATABASE_ID);
    assertExists(compiledCache);

    const renamed = await getLidarrByName(compiledCache, 'Lidarr-New');
    assertExists(renamed);
    assertEquals(renamed.entries.length, 1);
    assertEquals(renamed.entries[0].quality_name, 'AAC-192');

    const old = await getLidarrByName(compiledCache, 'Lidarr-Old');
    assertEquals(old, null);

    const rawRows = await compiledCache.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .select(['name', 'quality_name'])
      .execute();

    assertEquals(rawRows, [{ name: 'Lidarr-New', quality_name: 'AAC-192' }]);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('updateLidarrQualityDefinitions duplicate rename fails deterministically', async () => {
  const fixture = createCacheFixture(
    baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
  ('FLAC', 'lidarr', 'FLAC'),
  ('AAC-192', 'lidarr', 'AAC-192');

INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES
  ('Config-A', 'FLAC', 64, 1024, 320),
  ('Config-B', 'AAC-192', 96, 1500, 320);
`)
  );

  try {
    const current = await getLidarrByName(fixture.cache, 'Config-A');
    assertExists(current);

    await assertRejects(
      () =>
        updateLidarrQualityDefinitions({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          current,
          input: {
            name: 'Config-B',
            entries: current.entries,
          },
        }),
      Error,
      'A lidarr quality definitions config with name "Config-B" already exists'
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test('updateLidarrQualityDefinitions unmapped entries fail with explicit deterministic error', async () => {
  const fixture = createCacheFixture(
    baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('FLAC', 'lidarr', 'FLAC');

INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Config-A', 'FLAC', 64, 1024, 320);
`)
  );

  try {
    const current = await getLidarrByName(fixture.cache, 'Config-A');
    assertExists(current);

    await expectBadRequest(
      () =>
        updateLidarrQualityDefinitions({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          current,
          input: {
            name: 'Config-A',
            entries: [
              {
                quality_name: 'Unmapped-Audio',
                min_size: 1,
                max_size: 2,
                preferred_size: 1,
              },
            ],
          },
        }),
      'Unsupported quality names for quality definitions for lidarr: Unmapped-Audio',
      'quality_definitions_unmapped'
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test(
  'Lidarr quality definitions delete by name removes all rows including unmapped so name can be reused',
  async () => {
    const fixture = createCacheFixtureWithDb(
      baseQualityDefinitionsSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('FLAC', 'lidarr', 'FLAC');

INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES
  ('Delete-Me', 'FLAC', 64, 1024, 320),
  ('Delete-Me', 'Orphan-Q', 0, 0, 0);
`)
    );

    try {
      const current = await getLidarrByName(fixture.cache, 'Delete-Me');
      assertExists(current);
      assertEquals(current.entries.length, 1, 'getLidarrByName filters to mapped only');
      assertEquals(current.entries[0].quality_name, 'FLAC');

      fixture.db.exec("DELETE FROM lidarr_quality_definitions WHERE name = 'Delete-Me'");

      const rowsAfterDelete = await fixture.cache.kb
        .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
        .where('name', '=', 'Delete-Me')
        .selectAll()
        .execute();
      assertEquals(rowsAfterDelete.length, 0, 'all rows for config name must be removed');

      await fixture.cache.kb
        .insertInto('lidarr_quality_definitions' as keyof PCDDatabase)
        .values({
          name: 'Delete-Me',
          quality_name: 'FLAC',
          min_size: 64,
          max_size: 1024,
          preferred_size: 320,
        })
        .execute();

      const created = await getLidarrByName(fixture.cache, 'Delete-Me');
      assertExists(created);
      assertEquals(created.entries.length, 1);
      assertEquals(created.entries[0].quality_name, 'FLAC');
    } finally {
      await fixture.destroy();
    }
  }
);
