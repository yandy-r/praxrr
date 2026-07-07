// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { setCache, deleteCache } from '$pcd/database/registry.ts';
import { GET as GET_LIST } from '../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts';
import { GET as GET_NAMED } from '../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts';
import type { components } from '$api/v1.d.ts';

type ListGetEvent = Parameters<typeof GET_LIST>[0];
type NamedGetEvent = Parameters<typeof GET_NAMED>[0];
type ResolvedEntityListResponse = components['schemas']['ResolvedEntityListResponse'];
type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type ErrorResponse = components['schemas']['ErrorResponse'];

function buildLocals(authenticated: boolean) {
  return authenticated
    ? {
        user: {
          id: 1,
          username: 'user-1',
          password_hash: 'hash',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        session: null,
        authBypass: false,
      }
    : {
        user: null,
        session: null,
        authBypass: false,
      };
}

function buildListGetEvent(
  databaseId: string,
  entityType: string,
  query: string,
  authenticated: boolean
): ListGetEvent {
  const event: Partial<ListGetEvent> = {
    url: new URL(`http://localhost/api/v1/pcd/${databaseId}/resolved/${entityType}${query}`),
    params: { databaseId, entityType },
    locals: buildLocals(authenticated),
  };

  return event as ListGetEvent;
}

function buildNamedGetEvent(
  databaseId: string,
  entityType: string,
  name: string,
  query: string,
  authenticated: boolean
): NamedGetEvent {
  const event: Partial<NamedGetEvent> = {
    url: new URL(
      `http://localhost/api/v1/pcd/${databaseId}/resolved/${entityType}/${encodeURIComponent(name)}${query}`
    ),
    params: { databaseId, entityType, name },
    locals: buildLocals(authenticated),
  };

  return event as NamedGetEvent;
}

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

// Mirrors parityMapApi.test.ts's fixture recipe: an in-memory PCDCache covering only
// the tables the resolved-config readers under test touch (see
// pcd/resolved/readers.test.ts for the same recipe at the readers layer).
// `isBuilt: () => true` is added on top since the routes gate on `cache?.isBuilt()`.
function createCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(schemaAndDataSql);

  return {
    cache: { kb, isBuilt: () => true } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

const SCHEMA_AND_DATA_SQL = `
CREATE TABLE regular_expressions (
  name TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  description TEXT,
  regex101_id TEXT
);

CREATE TABLE tags (
  name TEXT PRIMARY KEY
);

CREATE TABLE regular_expression_tags (
  regular_expression_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  PRIMARY KEY (regular_expression_name, tag_name)
);

CREATE TABLE radarr_naming (
  name TEXT PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 1,
  movie_format TEXT NOT NULL,
  movie_folder_format TEXT NOT NULL,
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format TEXT NOT NULL DEFAULT 'delete',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*sample.*', 'A sample regular expression', NULL);

INSERT INTO radarr_naming (name, movie_format, movie_folder_format) VALUES
  ('Default', '{Movie Title} ({Release Year})', '{Movie Title} ({Release Year})');
`;

async function withFixture(fn: (databaseId: number) => Promise<void>): Promise<void> {
  const databaseId = 909090;
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  setCache(databaseId, fixture.cache);

  try {
    await fn(databaseId);
  } finally {
    deleteCache(databaseId);
    await fixture.destroy();
  }
}

// ============================================================================
// LIST ENDPOINT
// ============================================================================

Deno.test('list resolved entities: unauthenticated request returns 401', async () => {
  const response = await GET_LIST(buildListGetEvent('909090', 'regularExpression', '', false));
  assertEquals(response.status, 401);

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

Deno.test('list resolved entities: invalid databaseId returns 400', async () => {
  const response = await GET_LIST(buildListGetEvent('abc', 'regularExpression', '', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

Deno.test('list resolved entities: unbuilt/unknown database returns 400', async () => {
  const response = await GET_LIST(buildListGetEvent('424242', 'regularExpression', '', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assertEquals(body.error, 'Database not found');
});

Deno.test('list resolved entities: unknown entityType returns 400', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_LIST(buildListGetEvent(String(databaseId), 'notAnEntityType', '', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('notAnEntityType'));
  });
});

Deno.test('list resolved entities: invalid arrType returns 400', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_LIST(buildListGetEvent(String(databaseId), 'naming', '?arrType=plexarr', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('plexarr'));
  });
});

Deno.test('list resolved entities: layer=base is rejected with the not-yet-supported stub', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_LIST(buildListGetEvent(String(databaseId), 'regularExpression', '?layer=base', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assertEquals(body.error, 'layer not yet supported');
  });
});

Deno.test('list resolved entities: 200 returns the arr-agnostic entity list', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_LIST(buildListGetEvent(String(databaseId), 'regularExpression', '', true));
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityListResponse;
    assertEquals(body.databaseId, databaseId);
    assertEquals(body.entityType, 'regularExpression');
    assertEquals(body.layer, 'resolved');
    assert(body.entities.length > 0);

    for (const entity of body.entities) {
      assertEquals(entity.present, true);
      assertEquals(entity.hasPendingConflict, false);
      assert(entity.entity !== undefined && entity.entity !== null);
    }

    const names = body.entities.map((entity) => entity.name);
    assert(names.includes('Sample RE'));
  });
});

Deno.test('list resolved entities: 200 returns the per-arr entity list', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_LIST(buildListGetEvent(String(databaseId), 'naming', '?arrType=radarr', true));
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityListResponse;
    assertEquals(body.entityType, 'naming');
    assert(body.entities.length > 0);
    assert(body.entities.map((entity) => entity.name).includes('Default'));
  });
});

// ============================================================================
// NAMED ENDPOINT
// ============================================================================

Deno.test('get resolved entity: unauthenticated request returns 401', async () => {
  const response = await GET_NAMED(buildNamedGetEvent('909090', 'regularExpression', 'Sample RE', '', false));
  assertEquals(response.status, 401);
});

Deno.test('get resolved entity: invalid databaseId returns 400', async () => {
  const response = await GET_NAMED(buildNamedGetEvent('abc', 'regularExpression', 'Sample RE', '', true));
  assertEquals(response.status, 400);
});

Deno.test('get resolved entity: unbuilt/unknown database returns 400', async () => {
  const response = await GET_NAMED(buildNamedGetEvent('424242', 'regularExpression', 'Sample RE', '', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assertEquals(body.error, 'Database not found');
});

Deno.test('get resolved entity: unknown entityType returns 400', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_NAMED(buildNamedGetEvent(String(databaseId), 'notAnEntityType', 'Sample RE', '', true));
    assertEquals(response.status, 400);
  });
});

Deno.test('get resolved entity: invalid arrType returns 400', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'naming', 'Default', '?arrType=plexarr', true)
    );
    assertEquals(response.status, 400);
  });
});

Deno.test('get resolved entity: layer=user is rejected with the not-yet-supported stub', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '?layer=user', true)
    );
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assertEquals(body.error, 'layer not yet supported');
  });
});

Deno.test('get resolved entity: 200 returns the resolved entity state', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '', true)
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.databaseId, databaseId);
    assertEquals(body.entityType, 'regularExpression');
    assertEquals(body.name, 'Sample RE');
    assertEquals(body.layer, 'resolved');
    assertEquals(body.present, true);
    assertEquals(body.hasPendingConflict, false);
    assert(body.entity);
  });
});

Deno.test('get resolved entity: named miss in the resolved layer returns 404', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'Does Not Exist', '', true)
    );
    assertEquals(response.status, 404);

    const body = (await response.json()) as ErrorResponse;
    assert(typeof body.error === 'string' && body.error.length > 0);
  });
});
