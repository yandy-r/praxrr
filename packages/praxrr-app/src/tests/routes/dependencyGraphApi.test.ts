// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { setCache, deleteCache } from '$pcd/database/registry.ts';
import { GET as GET_GRAPH } from '../../routes/api/v1/pcd/[databaseId]/graph/+server.ts';
import { GET as GET_IMPACT } from '../../routes/api/v1/pcd/[databaseId]/graph/[nodeKind]/[...name]/+server.ts';
import type { components } from '$api/v1.d.ts';

type GraphGetEvent = Parameters<typeof GET_GRAPH>[0];
type ImpactGetEvent = Parameters<typeof GET_IMPACT>[0];
type DependencyGraphResponse = components['schemas']['DependencyGraphResponse'];
type GraphImpactResponse = components['schemas']['GraphImpactResponse'];
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

function buildGraphGetEvent(databaseId: string, query: string, authenticated: boolean): GraphGetEvent {
  const event: Partial<GraphGetEvent> = {
    url: new URL(`http://localhost/api/v1/pcd/${databaseId}/graph${query}`),
    params: { databaseId },
    locals: buildLocals(authenticated),
  };

  return event as GraphGetEvent;
}

function buildImpactGetEvent(
  databaseId: string,
  nodeKind: string,
  name: string,
  query: string,
  authenticated: boolean
): ImpactGetEvent {
  const event: Partial<ImpactGetEvent> = {
    url: new URL(`http://localhost/api/v1/pcd/${databaseId}/graph/${nodeKind}/${encodeURIComponent(name)}${query}`),
    // params.name is the decoded `[...name]` rest param; the handler reads it verbatim.
    params: { databaseId, nodeKind, name },
    locals: buildLocals(authenticated),
  };

  return event as ImpactGetEvent;
}

// ============================================================================
// IN-MEMORY PCDCACHE FIXTURE
// ============================================================================
//
// Mirrors tests/pcd/graph/references.test.ts's recipe: an in-memory PCDCache carrying
// only the tables the graph resolver + node/compat readers touch. `isBuilt: () => true`
// is layered on top because both graph route handlers gate on `cache?.isBuilt()`.

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createBuiltCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: db }) });
  db.exec(schemaAndDataSql);
  return {
    cache: { kb, isBuilt: () => true } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

// A `radarr`-scoped E1 edge carries `score` as an int64 `bigint` (the DB is opened with
// `int64: true`) -- the single bigint that reaches the response body, so a 200 JSON reply
// proves the handlers' `sanitizeBigInts` pass ran. 'My CF' exists so the reserved-char
// (space) impact routing case resolves to a real node instead of a by-name miss.
const SCHEMA_AND_DATA_SQL = `
CREATE TABLE custom_formats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE quality_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE regular_expressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE qualities (
  name TEXT PRIMARY KEY
);

CREATE TABLE quality_profile_custom_formats (
  quality_profile_name TEXT NOT NULL,
  custom_format_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (quality_profile_name, custom_format_name, arr_type)
);

CREATE TABLE custom_format_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  custom_format_name TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  arr_type TEXT NOT NULL DEFAULT 'all',
  negate INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE condition_patterns (
  custom_format_name TEXT NOT NULL,
  condition_name TEXT NOT NULL,
  regular_expression_name TEXT NOT NULL
);

CREATE TABLE quality_profile_qualities (
  quality_profile_name TEXT NOT NULL,
  quality_name TEXT,
  quality_group_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE quality_group_members (
  quality_profile_name TEXT NOT NULL,
  quality_group_name TEXT NOT NULL,
  quality_name TEXT NOT NULL
);

CREATE TABLE radarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL
);

CREATE TABLE sonarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL
);

CREATE TABLE lidarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL
);

CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL
);

INSERT INTO custom_formats (name) VALUES ('CF1'), ('My CF');
INSERT INTO quality_profiles (name) VALUES ('QP1');
INSERT INTO regular_expressions (name) VALUES ('RE1');
INSERT INTO qualities (name) VALUES ('HDTV-720p');

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
  ('QP1', 'CF1', 'radarr', 100);

INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required) VALUES
  ('CF1', 'c1', 'release_title', 'radarr', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES
  ('CF1', 'c1', 'RE1');

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, enabled) VALUES
  ('QP1', 'HDTV-720p', NULL, 1);

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
  ('HDTV-720p', 'radarr', 'HDTV-720p');
`;

const FIXTURE_DATABASE_ID = 808080;

async function withGraphFixture(fn: (databaseId: number) => Promise<void>): Promise<void> {
  const fixture = createBuiltCacheFixture(SCHEMA_AND_DATA_SQL);
  setCache(FIXTURE_DATABASE_ID, fixture.cache);
  try {
    await fn(FIXTURE_DATABASE_ID);
  } finally {
    deleteCache(FIXTURE_DATABASE_ID);
    await fixture.destroy();
  }
}

// ============================================================================
// GRAPH ENDPOINT
// ============================================================================

Deno.test('graph: unauthenticated request returns 401', async () => {
  const response = await GET_GRAPH(buildGraphGetEvent('808080', '', false));
  assertEquals(response.status, 401);

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

Deno.test('graph: non-digit databaseId returns 400', async () => {
  const response = await GET_GRAPH(buildGraphGetEvent('1abc', '', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('databaseId'));
});

Deno.test('graph: unknown database (no registered cache) returns 400, not 404', async () => {
  const response = await GET_GRAPH(buildGraphGetEvent('424242', '', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assertEquals(body.error, 'Database not found');
});

Deno.test('graph: unbuilt database (isBuilt() returns false) returns 400, not 404', async () => {
  const databaseId = 707070;
  setCache(databaseId, { isBuilt: () => false } as unknown as PCDCache);
  try {
    const response = await GET_GRAPH(buildGraphGetEvent(String(databaseId), '', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assertEquals(body.error, 'Database not found');
  } finally {
    deleteCache(databaseId);
  }
});

Deno.test('graph: invalid arrType returns 400', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_GRAPH(buildGraphGetEvent(String(databaseId), '?arrType=plexarr', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('plexarr'));
  });
});

Deno.test('graph: invalid nodeKind returns 400', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_GRAPH(buildGraphGetEvent(String(databaseId), '?nodeKind=notAKind', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('notAKind'));
  });
});

Deno.test('graph: 200 returns a well-formed dependency graph payload', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_GRAPH(buildGraphGetEvent(String(databaseId), '', true));
    assertEquals(response.status, 200);

    const body = (await response.json()) as DependencyGraphResponse;
    assertEquals(body.databaseId, databaseId);
    assert(Array.isArray(body.nodes) && body.nodes.length > 0);
    assert(Array.isArray(body.edges) && body.edges.length > 0);
    assert(Array.isArray(body.arrTypesPresent));
    assertEquals(body.truncated, false);

    // E1 (QP1 -> CF1, radarr) + E2 (CF1 -> RE1, radarr) + E3 (QP1 -> HDTV-720p, all)
    // are all present, so both edge scopes surface.
    assert(body.arrTypesPresent.includes('radarr'));
    assert(body.arrTypesPresent.includes('all'));
  });
});

Deno.test('graph: bigint cache values (int64 score) serialize via sanitizeBigInts without throwing', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_GRAPH(buildGraphGetEvent(String(databaseId), '', true));
    // A 200 JSON body is itself proof: the raw int64 `score` is a bigint, and SvelteKit's
    // `json()` throws on a bigint unless `sanitizeBigInts` coerced it first.
    assertEquals(response.status, 200);

    const body = (await response.json()) as DependencyGraphResponse;
    const scoredEdge = body.edges.find((edge) => edge.edgeKind === 'quality_profile_custom_format');
    assert(scoredEdge, 'expected the QP1 -> CF1 scored edge in the graph');
    assertEquals(typeof scoredEdge.score, 'number');
    assertEquals(scoredEdge.score, 100);
  });
});

// ============================================================================
// IMPACT ENDPOINT
// ============================================================================

Deno.test('impact: unauthenticated request returns 401', async () => {
  const response = await GET_IMPACT(buildImpactGetEvent('808080', 'custom_format', 'CF1', '', false));
  assertEquals(response.status, 401);

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

Deno.test('impact: non-digit databaseId returns 400', async () => {
  const response = await GET_IMPACT(buildImpactGetEvent('1abc', 'custom_format', 'CF1', '', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('databaseId'));
});

Deno.test('impact: unknown database (no registered cache) returns 400, not 404', async () => {
  const response = await GET_IMPACT(buildImpactGetEvent('424242', 'custom_format', 'CF1', '', true));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assertEquals(body.error, 'Database not found');
});

Deno.test('impact: unbuilt database (isBuilt() returns false) returns 400, not 404', async () => {
  const databaseId = 707071;
  setCache(databaseId, { isBuilt: () => false } as unknown as PCDCache);
  try {
    const response = await GET_IMPACT(buildImpactGetEvent(String(databaseId), 'custom_format', 'CF1', '', true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assertEquals(body.error, 'Database not found');
  } finally {
    deleteCache(databaseId);
  }
});

Deno.test('impact: invalid direction returns 400', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_IMPACT(
      buildImpactGetEvent(String(databaseId), 'custom_format', 'CF1', '?direction=sideways', true)
    );
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('sideways'));
  });
});

Deno.test('impact: invalid depth returns 400', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_IMPACT(
      buildImpactGetEvent(String(databaseId), 'custom_format', 'CF1', '?depth=abc', true)
    );
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('depth'));
  });
});

Deno.test('impact: well-formed request for a missing node name returns 404 (GraphNodeNotFoundError)', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_IMPACT(
      buildImpactGetEvent(String(databaseId), 'custom_format', 'Does Not Exist', '', true)
    );
    assertEquals(response.status, 404);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.includes('Does Not Exist'));
  });
});

Deno.test('impact: a reserved-char (space) node name is accepted and routed via the [...name] rest param', async () => {
  await withGraphFixture(async (databaseId) => {
    const response = await GET_IMPACT(buildImpactGetEvent(String(databaseId), 'custom_format', 'My CF', '', true));
    // The name must never be rejected on its own -- 'My CF' resolves to a real node, so
    // routing + resolution succeed (200); the guard is that it is NOT a 400 name error.
    assert(response.status !== 400);
    assertEquals(response.status, 200);

    const body = (await response.json()) as GraphImpactResponse;
    assertEquals(body.node.kind, 'custom_format');
    assertEquals(body.node.name, 'My CF');
    assertEquals(body.direction, 'dependents');
  });
});
