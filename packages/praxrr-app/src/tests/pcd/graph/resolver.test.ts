import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { buildDependencyGraph, getImpact } from '$pcd/graph/resolver.ts';
import { GraphNodeNotFoundError, IMPACT_MAX_DEPTH } from '$pcd/graph/types.ts';
import type { DependencyGraph, GraphNode, NodeKind } from '$pcd/graph/types.ts';

// Resolver behaviour guard for the read-only dependency graph. The fixture is a single
// connected component wired through every edge family the resolver traverses:
//   E1 quality_profile 'QP1' -> custom_format 'CF1'          (arr-scoped: radarr/sonarr/all)
//   E2 custom_format   'CF1' -> regular_expression 'RE1'     (via a condition; arr 'all')
//   E3 quality_profile 'QP1' -> quality 'SDTV'               (enabled; arr 'all')
//   E4 quality_definition 'QD SDTV' -> quality 'SDTV'        (radarr)
// Plus an orphan custom_format 'CF Orphan' (no edges) and an unreferenced quality row
// 'REGIONAL' that must never surface as a node (leaf kinds only appear inside edges).
interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: db }) });
  db.exec(schemaAndDataSql);
  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

const SCHEMA_AND_DATA_SQL = `
CREATE TABLE custom_formats (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE quality_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE regular_expressions (
  id INTEGER PRIMARY KEY,
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
  enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE quality_group_members (
  quality_profile_name TEXT NOT NULL,
  quality_group_name TEXT NOT NULL,
  quality_name TEXT NOT NULL
);

CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  api_name TEXT NOT NULL,
  arr_type TEXT NOT NULL
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

-- Linkable entities (id -> editor routeId). 'CF Orphan' participates in no edge.
INSERT INTO custom_formats (id, name) VALUES
  (20, 'CF1'),
  (21, 'CF Orphan');

INSERT INTO quality_profiles (id, name) VALUES
  (10, 'QP1');

INSERT INTO regular_expressions (id, name) VALUES
  (30, 'RE1');

-- 'SDTV' is referenced by edges; 'REGIONAL' is not, so it must never become a node.
INSERT INTO qualities (name) VALUES
  ('SDTV'),
  ('REGIONAL');

-- E1: QP1 scores CF1 across arr scopes. The 'sonarr' row is the one arr filtering drops.
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
  ('QP1', 'CF1', 'radarr', 100),
  ('QP1', 'CF1', 'sonarr', 50),
  ('QP1', 'CF1', 'all', 25);

-- E2: CF1's condition references RE1 (arr scope carried from the parent condition).
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required) VALUES
  ('CF1', 'cond1', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES
  ('CF1', 'cond1', 'RE1');

-- E3: QP1 enables the SDTV quality directly (not grouped).
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, enabled) VALUES
  ('QP1', 'SDTV', NULL, 1);

INSERT INTO quality_api_mappings (quality_name, api_name, arr_type) VALUES
  ('SDTV', 'SDTV', 'radarr'),
  ('SDTV', 'SDTV', 'sonarr');

-- E4: a radarr quality definition points at the SDTV quality.
INSERT INTO radarr_quality_definitions (name, quality_name) VALUES
  ('QD SDTV', 'SDTV');
`;

function withFixture(fn: (cache: PCDCache) => Promise<void>): Promise<void> {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  return fn(fixture.cache).finally(fixture.destroy);
}

const findNode = (graph: DependencyGraph, kind: NodeKind, name: string): GraphNode | undefined =>
  graph.nodes.find((node) => node.kind === kind && node.name === name);

Deno.test('getImpact(dependents) on a custom format reports quality-profile referrers', async () => {
  await withFixture(async (cache) => {
    const impact = await getImpact(
      cache,
      1,
      { kind: 'custom_format', name: 'CF1' },
      {
        direction: 'dependents',
        depth: 1,
      }
    );

    assertEquals(impact.hasDownstream, true);
    assert(impact.counts.quality_profile >= 1);
    assert(impact.counts.total >= 1);

    // byArrType is grouped by the edge arr scope; CF1 is scored on radarr/sonarr/all.
    assert(Array.isArray(impact.byArrType.radarr));
    assertEquals(Object.keys(impact.byArrType).sort(), ['all', 'radarr', 'sonarr']);

    // Focus node carries the custom_formats.id as its editor routeId.
    assertEquals(Number(impact.node.routeId), 20);
    assert(impact.node.inDegree >= 1);
  });
});

Deno.test('getImpact throws GraphNodeNotFoundError for an unknown node', async () => {
  await withFixture(async (cache) => {
    await assertRejects(
      () => getImpact(cache, 1, { kind: 'custom_format', name: 'Does Not Exist' }, {}),
      GraphNodeNotFoundError
    );
  });
});

Deno.test('getImpact clamps depth to IMPACT_MAX_DEPTH', async () => {
  await withFixture(async (cache) => {
    const impact = await getImpact(cache, 1, { kind: 'custom_format', name: 'CF1' }, { depth: 99 });

    assertEquals(impact.depth, IMPACT_MAX_DEPTH);
    assertEquals(impact.depth, 3);
    assert(impact.edges.length > 0);
    assertEquals(Number(impact.node.routeId), 20);
  });
});

Deno.test('getImpact(dependencies) on a quality profile returns its scored CF and enabled quality', async () => {
  await withFixture(async (cache) => {
    const impact = await getImpact(
      cache,
      1,
      { kind: 'quality_profile', name: 'QP1' },
      {
        direction: 'dependencies',
      }
    );

    assertEquals(impact.direction, 'dependencies');
    assert(
      impact.edges.some((edge) => edge.to.kind === 'custom_format' && edge.to.name === 'CF1'),
      'expected a dependency edge to the scored custom format CF1'
    );
    assert(
      impact.edges.some((edge) => edge.to.kind === 'quality' && edge.to.name === 'SDTV'),
      'expected a dependency edge to the enabled quality SDTV'
    );
    assert(impact.counts.custom_format >= 1);
    assert(impact.counts.quality >= 1);
  });
});

Deno.test('buildDependencyGraph returns entity nodes plus edge-participating leaf nodes', async () => {
  await withFixture(async (cache) => {
    const graph = await buildDependencyGraph(cache, 1);

    assertEquals(graph.truncated, false);

    // All linkable entities are present with a populated (non-null) routeId.
    const cf = findNode(graph, 'custom_format', 'CF1');
    const qp = findNode(graph, 'quality_profile', 'QP1');
    const re = findNode(graph, 'regular_expression', 'RE1');
    assert(cf, 'CF1 node missing');
    assert(qp, 'QP1 node missing');
    assert(re, 'RE1 node missing');
    assertEquals(Number(cf.routeId), 20);
    assertEquals(Number(qp.routeId), 10);
    assertEquals(Number(re.routeId), 30);
    for (const node of graph.nodes) {
      if (node.kind === 'custom_format' || node.kind === 'quality_profile' || node.kind === 'regular_expression') {
        assert(node.routeId !== null, `${node.kind} ${node.name} should have a routeId`);
      }
    }

    // The orphan custom format still appears, with zero in/out degree.
    const orphan = findNode(graph, 'custom_format', 'CF Orphan');
    assert(orphan, 'CF Orphan node missing');
    assertEquals(orphan.inDegree, 0);
    assertEquals(orphan.outDegree, 0);

    // Leaf kinds appear only because they participate in edges; routeId is null for them.
    const quality = findNode(graph, 'quality', 'SDTV');
    const definition = findNode(graph, 'quality_definition', 'QD SDTV');
    assert(quality, 'SDTV quality node missing');
    assert(definition, 'QD SDTV quality_definition node missing');
    assertEquals(quality.routeId, null);
    assertEquals(definition.routeId, null);

    // An unreferenced quality row must NOT become a node.
    assertEquals(findNode(graph, 'quality', 'REGIONAL'), undefined);

    // arrTypesPresent is the distinct set carried on the (unfiltered) edges.
    assertEquals([...graph.arrTypesPresent].sort(), ['all', 'radarr', 'sonarr']);
  });
});

Deno.test('buildDependencyGraph(arrType=radarr) keeps radarr and all edges, drops sonarr-only edges', async () => {
  await withFixture(async (cache) => {
    const full = await buildDependencyGraph(cache, 1);
    assert(
      full.edges.some((edge) => edge.arrType === 'sonarr'),
      'fixture should contain a sonarr edge to drop'
    );

    const graph = await buildDependencyGraph(cache, 1, { arrType: 'radarr' });

    assert(graph.edges.length > 0);
    assert(
      graph.edges.every((edge) => edge.arrType === 'radarr' || edge.arrType === 'all'),
      'radarr scope must keep only radarr + all edges'
    );
    assert(!graph.edges.some((edge) => edge.arrType === 'sonarr'), 'sonarr-only edges must be dropped');
    assert(
      graph.edges.some((edge) => edge.arrType === 'radarr'),
      'a radarr edge must survive'
    );
    assertEquals([...graph.arrTypesPresent].sort(), ['all', 'radarr']);
  });
});

Deno.test('buildDependencyGraph(nodeKind=custom_format) returns custom formats plus neighbours', async () => {
  await withFixture(async (cache) => {
    const graph = await buildDependencyGraph(cache, 1, { nodeKind: 'custom_format' });

    // Every edge must touch a custom_format endpoint.
    assert(
      graph.edges.every((edge) => edge.from.kind === 'custom_format' || edge.to.kind === 'custom_format'),
      'narrowed edge set must be incident to a custom_format'
    );

    // Both custom formats (including the orphan) plus their direct neighbours survive.
    assert(findNode(graph, 'custom_format', 'CF1'), 'CF1 node missing');
    assert(findNode(graph, 'custom_format', 'CF Orphan'), 'CF Orphan node missing');
    assert(findNode(graph, 'quality_profile', 'QP1'), 'QP1 neighbour missing');
    assert(findNode(graph, 'regular_expression', 'RE1'), 'RE1 neighbour missing');

    // Non-neighbour leaf kinds are excluded.
    assertEquals(findNode(graph, 'quality', 'SDTV'), undefined);
    assertEquals(findNode(graph, 'quality_definition', 'QD SDTV'), undefined);
  });
});

// Cross-Arr compatibility filtering: under a concrete arr filter, a quality profile whose
// compatibility (via computeProfileCompatibility) excludes that arr must be dropped from the
// graph; without a concrete arr (or arrType='all') it is kept. 'REGIONAL' is a radarr-only
// quality name, so 'RadarrOnly' resolves to compatibleArrTypes=['radarr'].
const ARR_COMPAT_SQL = `
CREATE TABLE custom_formats (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE quality_profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE regular_expressions (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE quality_profile_custom_formats (quality_profile_name TEXT, custom_format_name TEXT, arr_type TEXT, score INTEGER);
CREATE TABLE condition_patterns (custom_format_name TEXT, condition_name TEXT, regular_expression_name TEXT);
CREATE TABLE custom_format_conditions (id INTEGER PRIMARY KEY AUTOINCREMENT, custom_format_name TEXT, name TEXT, type TEXT, arr_type TEXT, negate INTEGER, required INTEGER);
CREATE TABLE quality_profile_qualities (id INTEGER PRIMARY KEY AUTOINCREMENT, quality_profile_name TEXT, quality_name TEXT, quality_group_name TEXT, position INTEGER, enabled INTEGER, upgrade_until INTEGER);
CREATE TABLE quality_group_members (quality_profile_name TEXT, quality_group_name TEXT, quality_name TEXT);
CREATE TABLE quality_api_mappings (quality_name TEXT, arr_type TEXT, api_name TEXT);
CREATE TABLE radarr_quality_definitions (name TEXT, quality_name TEXT, min_size REAL, max_size REAL, preferred_size REAL);
CREATE TABLE sonarr_quality_definitions (name TEXT, quality_name TEXT, min_size REAL, max_size REAL, preferred_size REAL);
CREATE TABLE lidarr_quality_definitions (name TEXT, quality_name TEXT, min_size REAL, max_size REAL, preferred_size REAL);

INSERT INTO quality_profiles (id, name) VALUES (1, 'RadarrOnly');
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES
  ('RadarrOnly', 'REGIONAL', NULL, 0, 1, 0);
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES ('REGIONAL', 'radarr', 'REGIONAL');
`;

Deno.test('buildDependencyGraph drops arr-incompatible quality profiles under a concrete arr filter', async () => {
  const fixture = createCacheFixture(ARR_COMPAT_SQL);
  const hasRadarrOnly = (graph: DependencyGraph) =>
    graph.nodes.some((node) => node.kind === 'quality_profile' && node.name === 'RadarrOnly');
  try {
    assert(hasRadarrOnly(await buildDependencyGraph(fixture.cache, 1, { arrType: 'radarr' })), 'kept under radarr');
    assert(!hasRadarrOnly(await buildDependencyGraph(fixture.cache, 1, { arrType: 'sonarr' })), 'dropped under sonarr');
    assert(hasRadarrOnly(await buildDependencyGraph(fixture.cache, 1, {})), 'kept when unfiltered');
  } finally {
    await fixture.destroy();
  }
});
