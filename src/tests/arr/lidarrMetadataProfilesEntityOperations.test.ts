import { assertEquals, assertExists, assertRejects } from '@std/assert';
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
import { create as createLidarrMetadataProfile } from '$pcd/entities/metadataProfiles/create.ts';
import {
  get,
  list,
  type LidarrMetadataProfile,
} from '$pcd/entities/metadataProfiles/read.ts';
import { update as updateLidarrMetadataProfile } from '$pcd/entities/metadataProfiles/update.ts';
import { remove as removeLidarrMetadataProfile } from '$pcd/entities/metadataProfiles/delete.ts';
import {
  GET as listMetadataProfilesGet,
  POST as createMetadataProfilesPost,
} from '../../routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts';
import {
  DELETE as deleteMetadataProfile,
  PUT as updateMetadataProfile,
} from '../../routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/[id]/+server.ts';
import { POST as importPortablePost } from '../../routes/api/v1/pcd/import/+server.ts';
import { GET as exportPortableGet } from '../../routes/api/v1/pcd/export/+server.ts';

const DATABASE_ID = 2401;

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

function baseMetadataProfilesSchema(extraInserts = ''): string {
  return `
CREATE TABLE IF NOT EXISTS lidarr_metadata_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_primary_types (
  metadata_profile_name TEXT NOT NULL,
  type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_secondary_types (
  metadata_profile_name TEXT NOT NULL,
  type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_release_statuses (
  metadata_profile_name TEXT NOT NULL,
  status_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

${extraInserts}
`;
}

async function createWriteHarness(schemaSql: string): Promise<WriteHarness> {
  const tempPath = `/tmp/profilarr-tests/lidarr-metadata-profiles-entity-${crypto.randomUUID()}`;
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
      uuid: 'lidarr-metadata-profiles-entity-ops',
      name: 'lidarr-metadata-profiles-entity-ops',
      repository_url: 'file:///tmp/lidarr-metadata-profiles-entity-ops',
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

async function getProfileByName(cache: PCDCache, name: string): Promise<LidarrMetadataProfile | null> {
  const row = await cache.kb
    .selectFrom('lidarr_metadata_profiles' as keyof PCDDatabase)
    .select('id')
    .where('name', '=', name)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return get(cache, row.id);
}

function getFreshCache(): RuntimePCDCache {
  const current = getCache(DATABASE_ID);
  assertExists(current);
  return current;
}

Deno.test('lidarr metadata profile read/list return parent and all child arrays', async () => {
  const fixture = createCacheFixture(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (name, description)
VALUES
  ('Lidarr-Mixed', 'Mixed metadata profile'),
  ('Solo', 'Single section profile');

INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed)
VALUES
  ('Lidarr-Mixed', 1, 'Album', 1),
  ('Lidarr-Mixed', 2, 'EP', 0);

INSERT INTO lidarr_metadata_profile_secondary_types (metadata_profile_name, type_id, name, allowed)
VALUES
  ('Lidarr-Mixed', 10, 'Compilation', 1);

INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed)
VALUES
  ('Lidarr-Mixed', 100, 'Official', 1),
  ('Lidarr-Mixed', 200, 'Unconfirmed', 0);
  `),
);

  try {
    const profiles = await list(fixture.cache);
    assertEquals(profiles.length, 2);

    const mixed = profiles[0];
    assertEquals(mixed.name, 'Lidarr-Mixed');
    assertEquals(mixed.description, 'Mixed metadata profile');
    assertEquals(mixed.primaryAlbumTypes.length, 2);
    assertEquals(mixed.secondaryAlbumTypes.length, 1);
    assertEquals(mixed.releaseStatuses.length, 2);

    assertEquals(mixed.primaryAlbumTypes[0], { typeId: 1, name: 'Album', allowed: true });
    assertEquals(mixed.primaryAlbumTypes[1], { typeId: 2, name: 'EP', allowed: false });

    const solo = profiles[1];
    assertEquals(solo.primaryAlbumTypes.length, 0);
    assertEquals(solo.secondaryAlbumTypes.length, 0);
    assertEquals(solo.releaseStatuses.length, 0);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('createLidarrMetadataProfile writes parent rows, child toggles, and operation metadata', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema()
  );

  try {
    const result = await createLidarrMetadataProfile({
      databaseId: DATABASE_ID,
      cache: harness.cache,
      layer: 'user',
      input: {
        name: 'Created-Profile',
        description: 'Created metadata profile',
        primaryAlbumTypes: [
          {
            typeId: 10,
            name: 'Album',
            allowed: true,
          },
          {
            typeId: 11,
            name: 'EP',
            allowed: false,
          },
        ],
        secondaryAlbumTypes: [
          {
            typeId: 20,
            name: 'Compilation',
            allowed: true,
          },
        ],
        releaseStatuses: [
          {
            statusId: 101,
            name: 'Unconfirmed',
            allowed: true,
          },
        ],
      },
    });

    assertEquals(result.success, true);
    assertEquals(harness.operations.length, 1);

    const createdMetadata = JSON.parse(harness.operations[0].metadata ?? '{}') as {
      entity?: string;
      stableKey?: { key?: string; value?: string };
      stable_key?: { key?: string; value?: string };
    };
    const createdStableKey = createdMetadata.stableKey ?? createdMetadata.stable_key;
    assertEquals(createdMetadata.entity, 'metadata_profile');
    assertEquals(createdStableKey?.key, 'metadata_profile_name');
    assertEquals(createdStableKey?.value, 'Created-Profile');
    assertEquals(harness.operations[0].sql.includes('lidarr_metadata_profiles'), true);

    const created = await getProfileByName(getFreshCache(), 'Created-Profile');
    assertEquals(created?.name, 'Created-Profile');
    assertEquals(created?.description, 'Created metadata profile');
    assertEquals(created?.primaryAlbumTypes.length, 2);
    assertEquals(created?.secondaryAlbumTypes.length, 1);
    assertEquals(created?.releaseStatuses.length, 1);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('createLidarrMetadataProfile duplicate name fails deterministically', async () => {
  const fixture = createCacheFixture(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (name, description)
VALUES ('Duplicate-Name', 'Existing profile');
`)
  );

  try {
    await assertRejects(
      () =>
        createLidarrMetadataProfile({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          input: {
            name: 'Duplicate-Name',
            description: null,
            primaryAlbumTypes: [],
            secondaryAlbumTypes: [],
            releaseStatuses: [],
          },
        }),
      Error,
      'A Lidarr metadata profile with name "Duplicate-Name" already exists'
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test('createLidarrMetadataProfile reserved name "None" is rejected', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema()
  );

  try {
    await assertRejects(
      () =>
        createLidarrMetadataProfile({
          databaseId: DATABASE_ID,
          cache: harness.cache,
          layer: 'user',
          input: {
            name: 'None',
            description: 'Reserved profile',
            primaryAlbumTypes: [
              {
                typeId: 1,
                name: 'Album',
                allowed: true,
              },
            ],
            secondaryAlbumTypes: [
              {
                typeId: 1,
                name: 'Compilation',
                allowed: true,
              },
            ],
            releaseStatuses: [
              {
                statusId: 1,
                name: 'Official',
                allowed: true,
              },
            ],
          },
        }),
      Error,
      "'None' is a reserved profile name"
    );
  } finally {
    await harness.cleanup();
  }
});

Deno.test('updateLidarrMetadataProfile updates parent identity and child sets', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (name, description)
VALUES ('Original', 'Original profile');

INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Original', 1, 'Album', 1);

INSERT INTO lidarr_metadata_profile_secondary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Original', 2, 'Compilation', 0);

INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed)
VALUES ('Original', 100, 'Official', 1);
`)
);

  try {
    const current = await getProfileByName(harness.cache, 'Original');
    assertExists(current);

    const result = await updateLidarrMetadataProfile({
      databaseId: DATABASE_ID,
      cache: harness.cache,
      layer: 'user',
      current,
      input: {
        name: 'Updated',
        description: 'Updated profile',
        primaryAlbumTypes: [
          {
            typeId: 1,
            name: 'Album',
            allowed: false,
          },
          {
            typeId: 3,
            name: 'EP',
            allowed: true,
          },
        ],
        secondaryAlbumTypes: [
          {
            typeId: 2,
            name: 'Compilation',
            allowed: true,
          },
        ],
        releaseStatuses: [
          {
            statusId: 100,
            name: 'Official',
            allowed: false,
          },
        ],
      },
    });

    assertEquals(result.success, true);
    assertEquals(harness.operations.length, 1);

    const updatedMetadata = JSON.parse(harness.operations[0].metadata ?? '{}') as {
      entity?: string;
      stableKey?: { key?: string; value?: string };
      stable_key?: { key?: string; value?: string };
      previousName?: string;
      changedFields?: string[];
      changed_fields?: string[];
    };
    const updatedStableKey = updatedMetadata.stableKey ?? updatedMetadata.stable_key;
    const updatedChangedFields = updatedMetadata.changedFields ?? updatedMetadata.changed_fields;

    assertEquals(updatedMetadata.entity, 'metadata_profile');
    assertEquals(updatedStableKey?.key, 'metadata_profile_name');
    assertEquals(updatedStableKey?.value, 'Original');
    assertEquals(updatedMetadata.previousName, 'Original');
    assertEquals(updatedChangedFields?.includes('name'), true);

    const renamed = await getProfileByName(getFreshCache(), 'Updated');
    assertExists(renamed);
    assertEquals(renamed.name, 'Updated');
    assertEquals(renamed.description, 'Updated profile');

    const oldProfile = await getProfileByName(getFreshCache(), 'Original');
    assertEquals(oldProfile, null);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('updateLidarrMetadataProfile duplicate rename and reserved name are rejected', async () => {
  const fixture = createCacheFixture(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (name, description)
VALUES ('Config-A', 'A');

INSERT INTO lidarr_metadata_profiles (name, description)
VALUES ('Config-B', 'B');
`)
  );

  try {
    const current = await getProfileByName(fixture.cache, 'Config-A');
    assertExists(current);

    await assertRejects(
      () =>
        updateLidarrMetadataProfile({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          current,
          input: {
            name: 'Config-B',
            description: 'A',
            primaryAlbumTypes: [],
            secondaryAlbumTypes: [],
            releaseStatuses: [],
          },
        }),
      Error,
      'A Lidarr metadata profile with name "Config-B" already exists'
    );

    await assertRejects(
      () =>
        updateLidarrMetadataProfile({
          databaseId: DATABASE_ID,
          cache: fixture.cache,
          layer: 'user',
          current,
          input: {
            name: 'None',
            description: 'A',
            primaryAlbumTypes: [],
            secondaryAlbumTypes: [],
            releaseStatuses: [],
          },
        }),
      Error,
      "'None' is a reserved profile name"
    );
  } finally {
    await fixture.destroy();
  }
});

Deno.test('removeLidarrMetadataProfile writes delete operation and removes all child rows', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (name, description)
VALUES ('Delete-Me', 'To be removed');

INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Delete-Me', 1, 'Album', 1),
       ('Delete-Me', 2, 'EP', 0);

INSERT INTO lidarr_metadata_profile_secondary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Delete-Me', 10, 'Compilation', 1);

INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed)
VALUES ('Delete-Me', 100, 'Official', 1);
`)
);

  try {
    const current = await getProfileByName(harness.cache, 'Delete-Me');
    assertExists(current);

    const result = await removeLidarrMetadataProfile({
      databaseId: DATABASE_ID,
      cache: harness.cache,
      layer: 'user',
      current,
    });

    assertEquals(result.success, true);
    assertEquals(harness.operations.length, 1);

    const refreshedCache = getFreshCache();
    const removed = await getProfileByName(refreshedCache, 'Delete-Me');
    assertEquals(removed, null);

    const rows = await refreshedCache.kb
      .selectFrom('lidarr_metadata_profile_primary_types' as keyof PCDDatabase)
      .where('metadata_profile_name', '=', 'Delete-Me')
      .selectAll()
      .execute();
    assertEquals(rows.length, 0);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('metadata profile list API route returns derived counts', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (id, name, description)
VALUES (77, 'Route-Profile', 'Route test');

INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Route-Profile', 1, 'Album', 1),
       ('Route-Profile', 2, 'EP', 1);

INSERT INTO lidarr_metadata_profile_secondary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Route-Profile', 10, 'Compilation', 0);

INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed)
VALUES ('Route-Profile', 100, 'Official', 1);
`)
);

  try {
    const response = await listMetadataProfilesGet({
      params: {
        databaseId: String(DATABASE_ID),
      },
    } as unknown as Parameters<typeof listMetadataProfilesGet>[0]);

    assertEquals(response.status, 200);
    const payload = await response.json() as Array<{
      id: number;
      name: string;
      primaryTypeCount: number;
      secondaryTypeCount: number;
      releaseStatusCount: number;
      primaryAllowedCount: number;
      secondaryAllowedCount: number;
      releaseStatusAllowedCount: number;
    }>;
    assertEquals(payload.length, 1);
    assertEquals(payload[0].name, 'Route-Profile');
    assertEquals(payload[0].primaryTypeCount, 2);
    assertEquals(payload[0].secondaryTypeCount, 1);
    assertEquals(payload[0].releaseStatusCount, 1);
    assertEquals(payload[0].primaryAllowedCount, 2);
    assertEquals(payload[0].secondaryAllowedCount, 0);
    assertEquals(payload[0].releaseStatusAllowedCount, 1);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('metadata profile API rejects section selections with no allowed entries on create', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema()
  );

  try {
    const response = await createMetadataProfilesPost({
      params: {
        databaseId: String(DATABASE_ID),
      },
      request: new Request('http://localhost/api/v1/pcd/2401/lidarr-metadata-profiles', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          layer: 'user',
          name: 'Invalid-Selections',
          description: 'missing allowed',
          primaryTypes: [
            {
              id: 1,
              name: 'Album',
              allowed: false,
            },
            {
              id: 2,
              name: 'EP',
              allowed: false,
            },
          ],
          secondaryTypes: [
            {
              id: 10,
              name: 'Compilation',
              allowed: true,
            },
          ],
          releaseStatuses: [
            {
              id: 100,
              name: 'Official',
              allowed: true,
            },
          ],
        }),
      }),
    } as unknown as Parameters<typeof createMetadataProfilesPost>[0]);

    assertEquals(response.status, 400);
    const payload = await response.json() as { error: string };
    assertEquals(payload.error, 'Each metadata profile section must include at least one allowed entry');
  } finally {
    await harness.cleanup();
  }
});

Deno.test('metadata profile API rejects reserved name "None" on create', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema()
  );

  try {
    const response = await createMetadataProfilesPost({
      params: {
        databaseId: String(DATABASE_ID),
      },
      request: new Request('http://localhost/api/v1/pcd/2401/lidarr-metadata-profiles', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          layer: 'user',
          name: 'None',
          description: 'reserved',
          primaryTypes: [
            {
              id: 1,
              name: 'Album',
              allowed: true,
            },
          ],
          secondaryTypes: [
            {
              id: 10,
              name: 'Compilation',
              allowed: true,
            },
          ],
          releaseStatuses: [
            {
              id: 100,
              name: 'Official',
              allowed: true,
            },
          ],
        }),
      }),
    } as unknown as Parameters<typeof createMetadataProfilesPost>[0]);

    assertEquals(response.status, 400);
    const payload = await response.json() as { error: string };
    assertEquals(payload.error, "'None' is a reserved profile name");
  } finally {
    await harness.cleanup();
  }
});

Deno.test('portable import for lidarr_metadata_profiles writes to lidarr metadata tables', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema()
  );

  try {
    const response = await importPortablePost({
      request: new Request('http://localhost/api/v1/pcd/import', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          databaseId: DATABASE_ID,
          layer: 'user',
          entityType: 'lidarr_metadata_profile',
          data: {
            name: 'Portable-Import',
            description: 'Imported portable metadata profile',
            primaryTypes: [
              { id: 1, name: 'Album', allowed: true },
              { id: 2, name: 'EP', allowed: false },
            ],
            secondaryTypes: [
              { id: 10, name: 'Compilation', allowed: true },
              { id: 11, name: 'Studio', allowed: false },
            ],
            releaseStatuses: [
              { id: 100, name: 'Official', allowed: true },
            ],
          },
        }),
      }),
    } as unknown as Parameters<typeof importPortablePost>[0]);

    assertEquals(response.status, 200);
    const payload = (await response.json()) as { success?: boolean };
    assertEquals(payload.success, true);

    const imported = await getProfileByName(getFreshCache(), 'Portable-Import');
    assertExists(imported);
    assertEquals(imported.primaryAlbumTypes.length, 2);
    assertEquals(imported.secondaryAlbumTypes.length, 2);
    assertEquals(imported.releaseStatuses.length, 1);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('portable export for lidarr_metadata_profiles reads from lidarr metadata tables', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (id, name, description)
VALUES (9901, 'Portable-Export', 'Export verification profile');

INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Portable-Export', 1, 'Album', 1),
       ('Portable-Export', 2, 'EP', 0);

INSERT INTO lidarr_metadata_profile_secondary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Portable-Export', 10, 'Compilation', 1);

INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed)
VALUES ('Portable-Export', 100, 'Official', 1),
       ('Portable-Export', 200, 'Unconfirmed', 0);
`)
  );

  try {
    const url = new URL('http://localhost/api/v1/pcd/export');
    url.searchParams.set('databaseId', String(DATABASE_ID));
    url.searchParams.set('entityType', 'lidarr_metadata_profile');
    url.searchParams.set('name', 'Portable-Export');

    const response = await exportPortableGet({
      url,
    } as unknown as Parameters<typeof exportPortableGet>[0]);

    assertEquals(response.status, 200);
    const payload = (await response.json()) as {
      entityType: string;
      data: {
        name: string;
        description: string | null;
        primaryTypes: Array<{ id: number; name: string; allowed: boolean }>;
        secondaryTypes: Array<{ id: number; name: string; allowed: boolean }>;
        releaseStatuses: Array<{ id: number; name: string; allowed: boolean }>;
      };
    };

    assertEquals(payload.entityType, 'lidarr_metadata_profile');
    assertEquals(payload.data.name, 'Portable-Export');
    assertEquals(payload.data.description, 'Export verification profile');
    assertEquals(payload.data.primaryTypes, [
      { id: 1, name: 'Album', allowed: true },
      { id: 2, name: 'EP', allowed: false },
    ]);
    assertEquals(payload.data.secondaryTypes, [{ id: 10, name: 'Compilation', allowed: true }]);
    assertEquals(payload.data.releaseStatuses, [
      { id: 100, name: 'Official', allowed: true },
      { id: 200, name: 'Unconfirmed', allowed: false },
    ]);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('metadata profile API rejects update payloads that result in no allowed entries', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (id, name, description)
VALUES (88, 'Route-Update', 'Route update test');

INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Route-Update', 1, 'Album', 1),
       ('Route-Update', 2, 'EP', 1);

INSERT INTO lidarr_metadata_profile_secondary_types (metadata_profile_name, type_id, name, allowed)
VALUES ('Route-Update', 10, 'Compilation', 1);

INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed)
VALUES ('Route-Update', 100, 'Official', 1);
`)
);

  try {
    const current = await getProfileByName(harness.cache, 'Route-Update');
    assertExists(current);

    const response = await updateMetadataProfile({
      params: {
        databaseId: String(DATABASE_ID),
        id: String(current.id),
      },
      request: new Request('http://localhost/api/v1/pcd/2401/lidarr-metadata-profiles/88', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          layer: 'user',
          name: 'Route-Update',
          primaryTypes: [
            {
              id: 1,
              name: 'Album',
              allowed: false,
            },
            {
              id: 2,
              name: 'EP',
              allowed: false,
            },
          ],
          secondaryTypes: [
            {
              id: 10,
              name: 'Compilation',
              allowed: false,
            },
          ],
          releaseStatuses: [
            {
              id: 100,
              name: 'Official',
              allowed: false,
            },
          ],
        }),
      }),
    } as unknown as Parameters<typeof updateMetadataProfile>[0]);

    assertEquals(response.status, 400);
    const payload = await response.json() as { error: string };
    assertEquals(payload.error, 'Each metadata profile section must include at least one allowed entry');
  } finally {
    await harness.cleanup();
  }
});

Deno.test('metadata profile API enforces delete body profile match when removing', async () => {
  const harness = await createWriteHarness(
    baseMetadataProfilesSchema(`
INSERT INTO lidarr_metadata_profiles (id, name, description)
VALUES (99, 'Route-Delete', 'To delete');
`)
);

  try {
    const profile = await getProfileByName(harness.cache, 'Route-Delete');
    assertExists(profile);

    const response = await deleteMetadataProfile({
      params: {
        databaseId: String(DATABASE_ID),
        id: String(profile.id),
      },
      request: new Request('http://localhost/api/v1/pcd/2401/lidarr-metadata-profiles/99', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          layer: 'user',
          name: 'Wrong-Name',
        }),
      }),
    } as unknown as Parameters<typeof deleteMetadataProfile>[0]);

    assertEquals(response.status, 400);
    const payload = await response.json() as { error: string };
    assertEquals(payload.error, 'Profile name does not match the selected profile');
  } finally {
    await harness.cleanup();
  }
});
