/**
 * Redaction/CORS/preview-equivalence regression sweep (Task 4.4).
 *
 * Two small, focused checks that complement the endpoint-behavior coverage in
 * `resolvedConfigApi.test.ts` and the credential sweep in `arrCredentialRedactionRoutes.test.ts`:
 *
 * (a) CORS absence (A2) -- none of the resolved-config endpoints ever set
 *     `Access-Control-Allow-Origin`; SvelteKit's bare `json()` helper never adds one, but
 *     this is a cheap tripwire against a future change accidentally wiring one in.
 * (b) Resolved-endpoint/serializer equivalence (Success Criterion 1) -- the named
 *     endpoint's `entity` payload must be produced by the exact same code path as
 *     `serialize.ts`'s direct reader output. A future change that forks the two paths
 *     (e.g. a route-local re-shaping of the entity) should fail this test.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { setCache, deleteCache } from '$pcd/database/registry.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { PcdOpHistoryWithOp } from '$db/queries/pcdOpHistory.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { serializeRegularExpression } from '$pcd/entities/serialize.ts';
import { GET as GET_LIST } from '../../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts';
import { GET as GET_NAMED } from '../../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts';
import {
  _liveDiffDependencies,
  GET as GET_DIFF,
} from '../../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/diff/+server.ts';
import { resetPreviewCreateRateLimitForTests } from '$sync/preview/limits.ts';
import type { components } from '$api/v1.d.ts';

type ResolvedEntityState = components['schemas']['ResolvedEntityState'];

// ============================================================================
// FIXTURE HELPERS -- minimal versions of resolvedConfigApi.test.ts's recipe.
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

function buildAuthenticatedLocals() {
  return {
    user: {
      id: 1,
      username: 'equivalence-test-user',
      password_hash: 'hash',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    session: null,
    authBypass: false,
  };
}

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

// Same tables/rows as resolvedConfigApi.test.ts's SCHEMA_AND_DATA_SQL, plus a tag row so
// the equivalence check also exercises the entity's nested-array field, not just scalars.
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

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*sample.*', 'A sample regular expression', NULL);

INSERT INTO tags (name) VALUES ('important');

INSERT INTO regular_expression_tags (regular_expression_name, tag_name) VALUES
  ('Sample RE', 'important');
`;

function createCacheFixture(): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(SCHEMA_AND_DATA_SQL);

  return {
    cache: { kb, isBuilt: () => true } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function buildArrInstanceFixture(id: number): ArrInstance {
  return {
    id,
    name: 'Equivalence Test Instance',
    type: 'radarr',
    url: 'http://radarr.local',
    external_url: null,
    api_key_fingerprint: null,
    api_key: '',
    tags: null,
    enabled: 1,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };
}

async function withFixture(databaseId: number, fn: (cache: PCDCache) => Promise<void>): Promise<void> {
  const fixture = createCacheFixture();
  setCache(databaseId, fixture.cache);

  const restores: Restore[] = [];
  // `resolveLayerState` (used by the named endpoint) always queries the app-DB conflict
  // history -- stub it to the common "no pending conflicts" case, per resolvedConfigApi.test.ts.
  patchTarget(
    pcdOpHistoryQueries,
    'listLatestConflictsByDatabase',
    (() => [] as PcdOpHistoryWithOp[]) as typeof pcdOpHistoryQueries.listLatestConflictsByDatabase,
    restores
  );

  try {
    await fn(fixture.cache);
  } finally {
    restores.reverse().forEach((restore) => restore());
    deleteCache(databaseId);
    await fixture.destroy();
  }
}

// ============================================================================
// (a) CORS ABSENCE (A2)
// ============================================================================

Deno.test('resolved config list endpoint never sets Access-Control-Allow-Origin', async () => {
  const databaseId = 950101;
  await withFixture(databaseId, async () => {
    const response = await GET_LIST({
      url: new URL(`http://localhost/api/v1/pcd/${databaseId}/resolved/regularExpression`),
      params: { databaseId: String(databaseId), entityType: 'regularExpression' },
      locals: buildAuthenticatedLocals(),
    } as unknown as Parameters<typeof GET_LIST>[0]);

    assertEquals(response.status, 200);
    assertEquals(response.headers.get('Access-Control-Allow-Origin'), null);
    assertEquals(response.headers.get('access-control-allow-origin'), null);
  });
});

Deno.test('resolved config diff endpoint never sets Access-Control-Allow-Origin', async () => {
  const databaseId = 950102;
  await withFixture(databaseId, async () => {
    const instance = buildArrInstanceFixture(950111);
    const restores: Restore[] = [];
    patchTarget(
      arrInstancesQueries,
      'getById',
      ((id: number) => (id === instance.id ? instance : undefined)) as typeof arrInstancesQueries.getById,
      restores
    );
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
      const response = await GET_DIFF({
        url: new URL(
          `http://localhost/api/v1/pcd/${databaseId}/resolved/regularExpression/Sample%20RE/diff?instanceId=${instance.id}`
        ),
        params: { databaseId: String(databaseId), entityType: 'regularExpression', name: 'Sample RE' },
        locals: buildAuthenticatedLocals(),
      } as unknown as Parameters<typeof GET_DIFF>[0]);

      assertEquals(response.status, 200);
      assertEquals(response.headers.get('Access-Control-Allow-Origin'), null);
      assertEquals(response.headers.get('access-control-allow-origin'), null);
    } finally {
      restores.reverse().forEach((restore) => restore());
      resetPreviewCreateRateLimitForTests();
    }
  });
});

// ============================================================================
// (b) RESOLVED-ENDPOINT / SERIALIZER EQUIVALENCE (Success Criterion 1)
// ============================================================================

Deno.test('resolved config named endpoint entity payload equals serializeRegularExpression output', async () => {
  const databaseId = 950103;
  await withFixture(databaseId, async (cache) => {
    const direct = await serializeRegularExpression(cache, 'Sample RE');

    const response = await GET_NAMED({
      url: new URL(`http://localhost/api/v1/pcd/${databaseId}/resolved/regularExpression/Sample%20RE`),
      params: { databaseId: String(databaseId), entityType: 'regularExpression', name: 'Sample RE' },
      locals: buildAuthenticatedLocals(),
    } as unknown as Parameters<typeof GET_NAMED>[0]);

    assertEquals(response.status, 200);
    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.present, true);
    assert(body.entity);

    // JSON round-trip both sides to normalize BigInt/undefined before comparing -- a
    // tripwire against the named endpoint's read path diverging from the direct
    // serializer's output, not a test of JSON encoding itself.
    const routeEntity = JSON.parse(JSON.stringify(body.entity));
    const directEntity = JSON.parse(JSON.stringify(direct));
    assertEquals(routeEntity, directEntity);
  });
});
