// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
// Value import (not `import type`) -- Task 3.1's layer=base/user fixtures patch
// `PCDCache.prototype.buildReadOnly`, which needs the class itself, not just its type.
import { PCDCache } from '$pcd/index.ts';
import { setCache, deleteCache } from '$pcd/database/registry.ts';
import { GET as GET_LIST } from '../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts';
import { GET as GET_NAMED } from '../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts';
import {
  _liveDiffDependencies,
  GET as GET_DIFF,
} from '../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/diff/+server.ts';
import type { components } from '$api/v1.d.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import type { PcdOp, UpdatePcdOpInput } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { CreatePcdOpHistoryInput, PcdOpHistory, PcdOpHistoryWithOp } from '$db/queries/pcdOpHistory.ts';
import {
  PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS,
  registerPreviewCreateAttempt,
  resetPreviewCreateRateLimitForTests,
} from '$sync/preview/limits.ts';
import { logger } from '$logger/logger.ts';

type ListGetEvent = Parameters<typeof GET_LIST>[0];
type NamedGetEvent = Parameters<typeof GET_NAMED>[0];
type DiffGetEvent = Parameters<typeof GET_DIFF>[0];
type ResolvedEntityListResponse = components['schemas']['ResolvedEntityListResponse'];
type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type ResolvedLiveDiffResponse = components['schemas']['ResolvedLiveDiffResponse'];
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

function buildDiffGetEvent(
  databaseId: string,
  entityType: string,
  name: string,
  query: string,
  authenticated: boolean
): DiffGetEvent {
  const event: Partial<DiffGetEvent> = {
    url: new URL(
      `http://localhost/api/v1/pcd/${databaseId}/resolved/${entityType}/${encodeURIComponent(name)}/diff${query}`
    ),
    params: { databaseId, entityType, name },
    locals: buildLocals(authenticated),
  };

  return event as DiffGetEvent;
}

// ============================================================================
// LIVE DIFF FIXTURE (Task 3.2)
// ============================================================================

function buildArrInstanceFixture(overrides: Partial<ArrInstance> = {}): ArrInstance {
  return {
    id: 590001,
    name: 'Radarr Live Diff Test',
    type: 'radarr',
    url: 'http://radarr.local',
    external_url: null,
    api_key_fingerprint: null,
    api_key: '',
    tags: null,
    enabled: 1,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

/** Patches `arrInstancesQueries.getById` to resolve only the given fixture instance. */
function withArrInstanceFixture(instance: ArrInstance, restores: Restore[]): void {
  patchTarget(
    arrInstancesQueries,
    'getById',
    ((id: number) => (id === instance.id ? instance : undefined)) as typeof arrInstancesQueries.getById,
    restores
  );
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

// ============================================================================
// PATCH-AND-RESTORE (Task 3.1) -- established codebase idiom, see
// tests/pcd/resolved/layers.test.ts and tests/pcd/resolved/cacheBuildReadOnly.test.ts.
// ============================================================================

type Restore = () => void;

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

/**
 * All resolved-config layer reads (`resolveLayerState`, and the list endpoint's
 * layer=base/user branches) compute `hasPendingConflict` via
 * `pcdOpHistoryQueries.listLatestConflictsByDatabase` -- a real app-DB query. Every
 * fixture below stubs it to `[]` by default (the common "no pending conflicts" case) so
 * route tests never depend on the app DB being initialized; `options.conflicts` lets
 * individual tests opt into a non-empty result.
 */
function patchNoConflictsByDefault(databaseId: number, restores: Restore[], conflicts?: PcdOpHistoryWithOp[]): void {
  patchTarget(
    pcdOpHistoryQueries,
    'listLatestConflictsByDatabase',
    ((id: number) =>
      id === databaseId ? (conflicts ?? []) : []) as typeof pcdOpHistoryQueries.listLatestConflictsByDatabase,
    restores
  );
}

async function withFixture(
  fn: (databaseId: number) => Promise<void>,
  options?: { conflicts?: PcdOpHistoryWithOp[] }
): Promise<void> {
  const databaseId = 909090;
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  setCache(databaseId, fixture.cache);

  const restores: Restore[] = [];
  patchNoConflictsByDefault(databaseId, restores, options?.conflicts);

  try {
    await fn(databaseId);
  } finally {
    restores.reverse().forEach((restore) => restore());
    deleteCache(databaseId);
    await fixture.destroy();
  }
}

// ============================================================================
// LAYER=BASE / LAYER=USER DIVERGENCE FIXTURE (Task 3.1)
// ============================================================================

// "Resolved" side: a registered fixture cache exactly like `withFixture`'s, but with
// three regularExpression rows exercising the three layer=base/user cases:
// - 'Sample RE': pattern differs from base -> a 'changed' FieldChange
// - 'Matches Base RE': identical in both layers -> empty overrides
// - 'User Only RE': absent from base entirely -> present:false at layer=base, and an
//   'added' FieldChange for every field at layer=user (entity created via user ops only)
const RESOLVED_LAYER_DIVERGENT_SQL = `
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

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*resolved-pattern.*', 'Shared description', NULL),
  ('Matches Base RE', '.*same-pattern.*', 'Shared description', NULL),
  ('User Only RE', '.*user-only-pattern.*', 'Created entirely via user ops', NULL);
`;

// "Base" side: schema+base+tweaks-only -- 'User Only RE' is deliberately absent.
const BASE_ONLY_SQL = `
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

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*base-pattern.*', 'Shared description', NULL),
  ('Matches Base RE', '.*same-pattern.*', 'Shared description', NULL);
`;

function buildLayerDivergenceDatabaseInstance(databaseId: number): DatabaseInstance {
  return {
    id: databaseId,
    uuid: 'resolved-config-api-layer-divergence-uuid',
    name: 'Resolved Config API Layer Divergence Test DB',
    repository_url: 'https://example.invalid/repo.git',
    local_path: '/tmp/resolved-config-api-layer-divergence-does-not-exist',
    sync_strategy: 0,
    auto_pull: 0,
    enabled: 1,
    personal_access_token: null,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };
}

/**
 * `withBaseOnlyCache` always constructs a real `PCDCache` (`new PCDCache(pcdPath, id)`),
 * so a fully-synthetic stub object (like `createCacheFixture`'s `{ kb, isBuilt }` cast)
 * cannot stand in for the base-layer side. Instead this patches
 * `PCDCache.prototype.buildReadOnly` to call the real (still-unpatched) private
 * `bootstrap()` -- which opens a working `:memory:` DB + Kysely instance, identically to
 * production -- and then `exec`s `BASE_ONLY_SQL` directly instead of replaying real
 * op files. `close()` is left unpatched: bootstrap() sets up real `db`/`kysely` fields,
 * so the real `close()` correctly tears them down. Same prototype-patch idiom as
 * `tests/pcd/resolved/layers.test.ts`, extended to produce an actually-queryable cache.
 */
async function withLayerDivergenceFixture(
  fn: (databaseId: number) => Promise<void>,
  options?: { conflicts?: PcdOpHistoryWithOp[] }
): Promise<void> {
  const databaseId = 909091;
  const resolvedFixture = createCacheFixture(RESOLVED_LAYER_DIVERGENT_SQL);
  setCache(databaseId, resolvedFixture.cache);

  const restores: Restore[] = [];
  patchNoConflictsByDefault(databaseId, restores, options?.conflicts);

  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((id: number) =>
      id === databaseId
        ? buildLayerDivergenceDatabaseInstance(databaseId)
        : undefined) as typeof databaseInstancesQueries.getById,
    restores
  );

  patchTarget(
    PCDCache.prototype,
    'buildReadOnly',
    async function (this: PCDCache) {
      const self = this as unknown as { bootstrap(): void; db: Database | null };
      self.bootstrap();
      self.db!.exec(BASE_ONLY_SQL);
      (this as unknown as { built: boolean }).built = true;
    } as typeof PCDCache.prototype.buildReadOnly,
    restores
  );

  try {
    await fn(databaseId);
  } finally {
    restores.reverse().forEach((restore) => restore());
    deleteCache(databaseId);
    await resolvedFixture.destroy();
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

// Superseded by Task 3.1: layer=base/user are now wired via `resolveLayerState` /
// `withBaseOnlyCache` instead of rejected with the "not yet supported" stub -- updated
// in place (not appended alongside) since the original assertion (400, stub message)
// describes behavior that no longer exists once this task lands, per the plan's own
// note that Task 3.1 supersedes it.
Deno.test(
  'list resolved entities: layer=base returns 200 with the base-layer entity list, built once per request',
  async () => {
    await withLayerDivergenceFixture(async (databaseId) => {
      const response = await GET_LIST(buildListGetEvent(String(databaseId), 'regularExpression', '?layer=base', true));
      assertEquals(response.status, 200);

      const body = (await response.json()) as ResolvedEntityListResponse;
      assertEquals(body.databaseId, databaseId);
      assertEquals(body.entityType, 'regularExpression');
      assertEquals(body.layer, 'base');

      // 'User Only RE' exists only in the resolved cache -- absent from the base-layer
      // list entirely (not a present:false row).
      const names = body.entities.map((entity) => entity.name).sort();
      assertEquals(names, ['Matches Base RE', 'Sample RE']);

      for (const entity of body.entities) {
        assertEquals(entity.present, true);
        assert(entity.entity !== undefined && entity.entity !== null);
      }

      const sampleRe = body.entities.find((entity) => entity.name === 'Sample RE');
      assert(sampleRe?.entity);
      assertEquals((sampleRe.entity as { pattern: string }).pattern, '.*base-pattern.*');
    });
  }
);

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

// Superseded by Task 3.1 -- see the matching note on the list endpoint's equivalent
// test above.
Deno.test('get resolved entity: layer=user returns 200 with the field-level override diff', async () => {
  await withLayerDivergenceFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '?layer=user', true)
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.databaseId, databaseId);
    assertEquals(body.entityType, 'regularExpression');
    assertEquals(body.name, 'Sample RE');
    assertEquals(body.layer, 'user');
    assertEquals(body.present, true);
    assertEquals(body.hasPendingConflict, false);
    assertEquals(body.entity, undefined);
    assertEquals(body.overrides, [
      { field: 'pattern', type: 'changed', current: '.*base-pattern.*', desired: '.*resolved-pattern.*' },
    ]);
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

// ============================================================================
// LAYER=BASE / LAYER=USER (Task 3.1)
// ============================================================================

Deno.test('get resolved entity: layer=base returns the base-layer entity when it differs from resolved', async () => {
  await withLayerDivergenceFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '?layer=base', true)
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.databaseId, databaseId);
    assertEquals(body.layer, 'base');
    assertEquals(body.present, true);
    assertEquals(body.hasPendingConflict, false);
    assert(body.entity);
    assertEquals((body.entity as { pattern: string }).pattern, '.*base-pattern.*');
  });
});

Deno.test('get resolved entity: layer=base returns present:false (not 404) for a user-op-only entity', async () => {
  await withLayerDivergenceFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'User Only RE', '?layer=base', true)
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.layer, 'base');
    assertEquals(body.present, false);
    assertEquals(body.entity, null);
    assertEquals(body.hasPendingConflict, false);
  });
});

Deno.test('get resolved entity: layer=user returns an empty overrides array when resolved matches base', async () => {
  await withLayerDivergenceFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'Matches Base RE', '?layer=user', true)
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.layer, 'user');
    assertEquals(body.present, true);
    assertEquals(body.overrides, []);
  });
});

Deno.test('get resolved entity: layer=user reports every field as added for a user-op-only entity', async () => {
  await withLayerDivergenceFixture(async (databaseId) => {
    const response = await GET_NAMED(
      buildNamedGetEvent(String(databaseId), 'regularExpression', 'User Only RE', '?layer=user', true)
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.layer, 'user');
    assertEquals(body.present, true);
    assert(body.overrides && body.overrides.length > 0);
    assert(body.overrides.every((change) => change.type === 'added'));
  });
});

Deno.test('get resolved entity: layer=base request performs zero writes to pcd_ops/pcd_op_history', async () => {
  await withLayerDivergenceFixture(async (databaseId) => {
    const restores: Restore[] = [];
    let updateCalls = 0;
    let createCalls = 0;

    patchTarget(
      pcdOpsQueries,
      'update',
      ((_id: number, _input: UpdatePcdOpInput) => {
        updateCalls += 1;
        return true;
      }) as typeof pcdOpsQueries.update,
      restores
    );
    patchTarget(
      pcdOpHistoryQueries,
      'create',
      ((_input: CreatePcdOpHistoryInput) => {
        createCalls += 1;
        return 1;
      }) as typeof pcdOpHistoryQueries.create,
      restores
    );

    try {
      const response = await GET_NAMED(
        buildNamedGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '?layer=base', true)
      );
      assertEquals(response.status, 200);

      const listResponse = await GET_LIST(
        buildListGetEvent(String(databaseId), 'regularExpression', '?layer=base', true)
      );
      assertEquals(listResponse.status, 200);
    } finally {
      restores.reverse().forEach((restore) => restore());
    }

    assertEquals(updateCalls, 0, 'layer=base reads must never call pcdOpsQueries.update');
    assertEquals(createCalls, 0, 'layer=base reads must never call pcdOpHistoryQueries.create');
  });
});

Deno.test(
  'get resolved entity: hasPendingConflict surfaces when the conflict query reports a matching entity',
  async () => {
    const conflictOp: PcdOp = {
      id: 1,
      database_id: 909090,
      origin: 'user',
      state: 'published',
      source: 'local',
      filename: null,
      op_number: null,
      sequence: null,
      sql: 'SELECT 1',
      metadata: JSON.stringify({ entity: 'regular_expression', name: 'Sample RE' }),
      desired_state: null,
      content_hash: null,
      last_seen_in_repo_at: null,
      superseded_by_op_id: null,
      pushed_at: null,
      pushed_commit: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
    };
    const conflictHistory: PcdOpHistory = {
      id: 1,
      op_id: 1,
      database_id: 909090,
      batch_id: 'batch-1',
      status: 'conflicted_pending',
      rowcount: null,
      conflict_reason: 'value_mismatch',
      error: null,
      details: null,
      applied_at: '2026-01-01 00:00:00',
    };

    await withFixture(
      async (databaseId) => {
        const conflicted = await GET_NAMED(
          buildNamedGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '', true)
        );
        assertEquals(conflicted.status, 200);
        const conflictedBody = (await conflicted.json()) as ResolvedEntityState;
        assertEquals(conflictedBody.hasPendingConflict, true);

        // A different entity's metadata does not correlate to the stubbed conflict --
        // hasPendingConflict must not be a blanket `true` once any conflict exists.
        const unrelated = await GET_NAMED(
          buildNamedGetEvent(String(databaseId), 'naming', 'Default', '?arrType=radarr', true)
        );
        assertEquals(unrelated.status, 200);
        const unrelatedBody = (await unrelated.json()) as ResolvedEntityState;
        assertEquals(unrelatedBody.hasPendingConflict, false);
      },
      { conflicts: [{ history: conflictHistory, op: conflictOp }] }
    );
  }
);

// ============================================================================
// DIFF ENDPOINT (Task 3.2)
// ============================================================================

Deno.test('get resolved entity live diff: unauthenticated request returns 401', async () => {
  const response = await GET_DIFF(
    buildDiffGetEvent('909090', 'regularExpression', 'Sample RE', '?instanceId=1', false)
  );
  assertEquals(response.status, 401);
});

Deno.test('get resolved entity live diff: invalid databaseId returns 400', async () => {
  const response = await GET_DIFF(buildDiffGetEvent('abc', 'regularExpression', 'Sample RE', '?instanceId=1', true));
  assertEquals(response.status, 400);
});

Deno.test('get resolved entity live diff: unbuilt/unknown database returns 400', async () => {
  const response = await GET_DIFF(buildDiffGetEvent('424242', 'regularExpression', 'Sample RE', '?instanceId=1', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assertEquals(body.error, 'Database not found');
});

Deno.test('get resolved entity live diff: unknown entityType returns 400', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_DIFF(
      buildDiffGetEvent(String(databaseId), 'notAnEntityType', 'Sample RE', '?instanceId=1', true)
    );
    assertEquals(response.status, 400);
  });
});

Deno.test('get resolved entity live diff: missing/invalid instanceId returns 400', async () => {
  await withFixture(async (databaseId) => {
    const response = await GET_DIFF(buildDiffGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('instanceId'));
  });
});

Deno.test('get resolved entity live diff: unknown instance returns 404', async () => {
  await withFixture(async (databaseId) => {
    const restores: Restore[] = [];
    patchTarget(arrInstancesQueries, 'getById', (() => undefined) as typeof arrInstancesQueries.getById, restores);

    try {
      const response = await GET_DIFF(
        buildDiffGetEvent(String(databaseId), 'regularExpression', 'Sample RE', '?instanceId=999999', true)
      );
      assertEquals(response.status, 404);

      const body = (await response.json()) as ErrorResponse;
      assert(typeof body.error === 'string' && body.error.length > 0);
    } finally {
      restores.reverse().forEach((restore) => restore());
    }
  });
});

// regularExpression has no sync-preview section counterpart -- computeLiveDiff
// short-circuits it to `{ reason: 'unsupported' }` before any gating or preview call
// (see liveDiff.ts), so this exercises the real (unstubbed) computeLiveDiff without
// touching the network.
Deno.test('get resolved entity live diff: unsupported entityType returns 400', async () => {
  await withFixture(async (databaseId) => {
    const instance = buildArrInstanceFixture({ id: 590002 });
    const restores: Restore[] = [];
    withArrInstanceFixture(instance, restores);

    try {
      const response = await GET_DIFF(
        buildDiffGetEvent(String(databaseId), 'regularExpression', 'Sample RE', `?instanceId=${instance.id}`, true)
      );
      assertEquals(response.status, 400);

      const body = (await response.json()) as ErrorResponse;
      assert(body.error.includes('regularExpression'));
    } finally {
      restores.reverse().forEach((restore) => restore());
      resetPreviewCreateRateLimitForTests();
    }
  });
});

Deno.test('get resolved entity live diff: 429 after the per-instance rate limit is exhausted', async () => {
  await withFixture(async (databaseId) => {
    const instance = buildArrInstanceFixture({ id: 590003 });
    const restores: Restore[] = [];
    withArrInstanceFixture(instance, restores);

    try {
      const nowMs = Date.now();
      for (let attempt = 0; attempt < PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS; attempt++) {
        registerPreviewCreateAttempt(instance.id, nowMs);
      }

      const response = await GET_DIFF(
        buildDiffGetEvent(String(databaseId), 'regularExpression', 'Sample RE', `?instanceId=${instance.id}`, true)
      );
      assertEquals(response.status, 429);

      const body = (await response.json()) as ErrorResponse;
      assert(typeof body.error === 'string' && body.error.length > 0);
    } finally {
      restores.reverse().forEach((restore) => restore());
      resetPreviewCreateRateLimitForTests();
    }
  });
});

Deno.test('get resolved entity live diff: 200 returns the live diff for the named entity', async () => {
  await withFixture(async (databaseId) => {
    const instance = buildArrInstanceFixture({ id: 590004, type: 'radarr' });
    const restores: Restore[] = [];
    withArrInstanceFixture(instance, restores);

    patchTarget(
      _liveDiffDependencies,
      'computeLiveDiff',
      (async () => ({
        found: true,
        change: {
          entityType: 'regularExpression',
          name: 'Sample RE',
          action: 'unchanged',
          remoteId: null,
          fields: [],
        },
      })) as typeof _liveDiffDependencies.computeLiveDiff,
      restores
    );

    try {
      const response = await GET_DIFF(
        buildDiffGetEvent(String(databaseId), 'regularExpression', 'Sample RE', `?instanceId=${instance.id}`, true)
      );
      assertEquals(response.status, 200);

      const body = (await response.json()) as ResolvedLiveDiffResponse;
      assertEquals(body.databaseId, databaseId);
      assertEquals(body.entityType, 'regularExpression');
      assertEquals(body.name, 'Sample RE');
      assertEquals(body.instanceId, instance.id);
      assertEquals(body.arrType, 'radarr');
      assertEquals(body.changes.length, 1);
      assertEquals(body.changes[0].action, 'unchanged');
      assertEquals(body.changes[0].fields, []);
    } finally {
      restores.reverse().forEach((restore) => restore());
      resetPreviewCreateRateLimitForTests();
    }
  });
});

Deno.test('get resolved entity live diff: entity not found on the instance returns 404', async () => {
  await withFixture(async (databaseId) => {
    const instance = buildArrInstanceFixture({ id: 590005, type: 'radarr' });
    const restores: Restore[] = [];
    withArrInstanceFixture(instance, restores);

    patchTarget(
      _liveDiffDependencies,
      'computeLiveDiff',
      (async () => ({ found: false, reason: 'not_found' })) as typeof _liveDiffDependencies.computeLiveDiff,
      restores
    );

    try {
      const response = await GET_DIFF(
        buildDiffGetEvent(String(databaseId), 'regularExpression', 'Missing RE', `?instanceId=${instance.id}`, true)
      );
      assertEquals(response.status, 404);
    } finally {
      restores.reverse().forEach((restore) => restore());
      resetPreviewCreateRateLimitForTests();
    }
  });
});

Deno.test('get resolved entity live diff: sanitized infra failure reason maps to 500', async () => {
  await withFixture(async (databaseId) => {
    const instance = buildArrInstanceFixture({ id: 590006, type: 'radarr' });
    const restores: Restore[] = [];
    withArrInstanceFixture(instance, restores);
    patchTarget(logger, 'error', (async () => undefined) as typeof logger.error, restores);

    patchTarget(
      _liveDiffDependencies,
      'computeLiveDiff',
      (async () => ({ found: false, reason: 'unreachable' })) as typeof _liveDiffDependencies.computeLiveDiff,
      restores
    );

    try {
      const response = await GET_DIFF(
        buildDiffGetEvent(String(databaseId), 'regularExpression', 'Sample RE', `?instanceId=${instance.id}`, true)
      );
      assertEquals(response.status, 500);

      const body = (await response.json()) as ErrorResponse;
      // Raw reason strings never escape into the response body.
      assert(!body.error.includes('unreachable'));
    } finally {
      restores.reverse().forEach((restore) => restore());
      resetPreviewCreateRateLimitForTests();
    }
  });
});
