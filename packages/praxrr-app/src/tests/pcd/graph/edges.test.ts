import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { getAllEdges, getIncomingEdges, getOutgoingEdges } from '$pcd/graph/edges.ts';

// Edge-catalog coverage for the E1-E4 families the reviewer flagged as error-prone:
// arr-scope fidelity ('all' stays 'all', per-arr definitions stay per-arr, condition
// arr_type comes from the PARENT), and the E3 direct-vs-grouped distinction (grouped
// carries groupName; a quality that is both a direct pick and a group member is two
// DISTINCT edges, never merged or double-counted). Fixture recipe mirrors
// references.test.ts (in-memory SQLite via a real Kysely, cast to PCDCache).
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quality_profile_name TEXT NOT NULL,
  quality_name TEXT,
  quality_group_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  upgrade_until INTEGER NOT NULL DEFAULT 0
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

-- E1: quality_profile -> custom_format. CF1 scored across arrs (incl. distinct 'all');
-- CF2 is a decoy that must never surface for CF1.
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
  ('QP CF Test', 'CF1', 'radarr', 10),
  ('QP CF Test', 'CF1', 'all', 25),
  ('Other Profile', 'CF1', 'sonarr', 50),
  ('QP CF Test', 'CF2', 'radarr', 5);

-- E2: custom_format -> regular_expression. arr_type is sourced from the PARENT condition,
-- not condition_patterns (which has none). CFX is scoped 'radarr'; CFY is 'all'.
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required) VALUES
  ('CFX', 'c1', 'release_title', 'radarr', 0, 1),
  ('CFY', 'c2', 'release_title', 'all', 1, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES
  ('CFX', 'c1', 'RE1'),
  ('CFY', 'c2', 'RE1'),
  ('CFX', 'c1', 'RE2');

-- E3: quality_profile -> quality. Two direct picks (quality_group_name NULL) and one group
-- reference. 'Bluray-1080p' is BOTH a direct pick and an 'HD Group' member so the direct
-- and grouped edges must stay distinct (not double-counted).
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name) VALUES
  ('QP Qual Test', 'WEBDL-1080p', NULL),
  ('QP Qual Test', 'Bluray-1080p', NULL),
  ('QP Qual Test', NULL, 'HD Group');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES
  ('QP Qual Test', 'HD Group', 'Bluray-720p'),
  ('QP Qual Test', 'HD Group', 'Bluray-1080p');

-- E4: quality_definition -> quality. Same quality_name in radarr + sonarr => two distinct
-- per-arr edges. lidarr carries an unrelated definition (table present, no fanout).
INSERT INTO radarr_quality_definitions (name, quality_name) VALUES ('Remux-2160p', 'Remux-2160p');
INSERT INTO sonarr_quality_definitions (name, quality_name) VALUES ('Remux-2160p', 'Remux-2160p');
INSERT INTO lidarr_quality_definitions (name, quality_name) VALUES ('FLAC', 'FLAC');
`;

function withFixture(fn: (cache: PCDCache) => Promise<void>): Promise<void> {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  return fn(fixture.cache).finally(fixture.destroy);
}

// ============================================================================
// E1: quality_profile -> custom_format (quality_profile_custom_formats)
// ============================================================================

Deno.test('E1 getIncomingEdges(custom_format) returns scoring profiles; the all edge stays all', async () => {
  await withFixture(async (cache) => {
    const edges = await getIncomingEdges(cache, { kind: 'custom_format', name: 'CF1' });
    assertEquals(edges.length, 3);
    for (const edge of edges) {
      assertEquals(edge.from.kind, 'quality_profile');
      assertEquals(edge.to.kind, 'custom_format');
      assertEquals(edge.to.name, 'CF1');
      assertEquals(edge.edgeKind, 'quality_profile_custom_format');
    }
    // CF2's scorer must never leak into CF1's incoming edges.
    assert(edges.every((edge) => edge.to.name === 'CF1'));
    // arr scopes carried verbatim, one each; 'all' is DISTINCT and never expanded to radarr/sonarr.
    assertEquals(edges.map((edge) => edge.arrType).sort(), ['all', 'radarr', 'sonarr']);
    const allEdge = edges.find((edge) => edge.arrType === 'all');
    assert(allEdge);
    assertEquals(allEdge.from.name, 'QP CF Test');
    assertEquals(Number(allEdge.score), 25);
    assertEquals(edges.filter((edge) => edge.arrType === 'all').length, 1);
  });
});

Deno.test('E1 getOutgoingEdges(quality_profile) returns scored custom formats', async () => {
  await withFixture(async (cache) => {
    const edges = (await getOutgoingEdges(cache, { kind: 'quality_profile', name: 'QP CF Test' })).filter(
      (edge) => edge.edgeKind === 'quality_profile_custom_format'
    );
    assertEquals(edges.length, 3);
    const scored = edges.map((edge) => `${edge.to.name}/${edge.arrType}/${Number(edge.score)}`).sort();
    assertEquals(scored, ['CF1/all/25', 'CF1/radarr/10', 'CF2/radarr/5']);
  });
});

// ============================================================================
// E2: custom_format -> regular_expression (condition_patterns join conditions)
// ============================================================================

Deno.test('E2 getIncomingEdges(regular_expression) takes arrType from the parent condition', async () => {
  await withFixture(async (cache) => {
    const edges = await getIncomingEdges(cache, { kind: 'regular_expression', name: 'RE1' });
    assertEquals(edges.length, 2);
    for (const edge of edges) {
      assertEquals(edge.from.kind, 'custom_format');
      assertEquals(edge.to.kind, 'regular_expression');
      assertEquals(edge.to.name, 'RE1');
      assertEquals(edge.edgeKind, 'custom_format_regular_expression');
    }
    const cfx = edges.find((edge) => edge.from.name === 'CFX');
    assert(cfx);
    // arr_type flows from custom_format_conditions.arr_type, NOT condition_patterns.
    assertEquals(cfx.arrType, 'radarr');
    const cfy = edges.find((edge) => edge.from.name === 'CFY');
    assert(cfy);
    assertEquals(cfy.arrType, 'all');
  });
});

Deno.test('E2 getOutgoingEdges(custom_format) returns referenced regular expressions with parent arrType', async () => {
  await withFixture(async (cache) => {
    const edges = await getOutgoingEdges(cache, { kind: 'custom_format', name: 'CFX' });
    assertEquals(edges.length, 2);
    assertEquals(
      edges.map((edge) => edge.to.name),
      ['RE1', 'RE2']
    );
    for (const edge of edges) {
      assertEquals(edge.from.name, 'CFX');
      assertEquals(edge.arrType, 'radarr');
      assertEquals(edge.edgeKind, 'custom_format_regular_expression');
    }
  });
});

// ============================================================================
// E3: quality_profile -> quality (direct + grouped; arrType always 'all')
// ============================================================================

Deno.test('E3 getOutgoingEdges(quality_profile) emits distinct direct and grouped quality edges', async () => {
  await withFixture(async (cache) => {
    const edges = (await getOutgoingEdges(cache, { kind: 'quality_profile', name: 'QP Qual Test' })).filter(
      (edge) => edge.edgeKind === 'quality_profile_quality'
    );
    assertEquals(edges.length, 4);
    for (const edge of edges) {
      assertEquals(edge.from.kind, 'quality_profile');
      assertEquals(edge.from.name, 'QP Qual Test');
      assertEquals(edge.to.kind, 'quality');
      // E3 is never edge-arr-scoped.
      assertEquals(edge.arrType, 'all');
    }
    // Direct picks (quality_group_name NULL) carry no groupName.
    const direct = edges.filter((edge) => edge.groupName === undefined);
    assertEquals(direct.map((edge) => edge.to.name).sort(), ['Bluray-1080p', 'WEBDL-1080p']);
    // Grouped edges carry the group name.
    const grouped = edges.filter((edge) => edge.groupName !== undefined);
    assertEquals(grouped.map((edge) => edge.to.name).sort(), ['Bluray-1080p', 'Bluray-720p']);
    for (const edge of grouped) {
      assertEquals(edge.groupName, 'HD Group');
    }
    // 'Bluray-1080p' is both a direct pick and a group member -> two DISTINCT edges, not merged.
    const bluray1080 = edges.filter((edge) => edge.to.name === 'Bluray-1080p');
    assertEquals(bluray1080.length, 2);
    assertEquals(bluray1080.filter((edge) => edge.groupName === undefined).length, 1);
    assertEquals(bluray1080.filter((edge) => edge.groupName === 'HD Group').length, 1);
  });
});

Deno.test('E3 getIncomingEdges(quality) returns the profile via both direct and grouped membership', async () => {
  await withFixture(async (cache) => {
    const edges = await getIncomingEdges(cache, { kind: 'quality', name: 'Bluray-1080p' });
    // Direct pick + HD Group membership both point at this quality; no definition references it.
    assertEquals(edges.length, 2);
    for (const edge of edges) {
      assertEquals(edge.edgeKind, 'quality_profile_quality');
      assertEquals(edge.from.name, 'QP Qual Test');
      assertEquals(edge.to.name, 'Bluray-1080p');
      assertEquals(edge.arrType, 'all');
    }
    assertEquals(edges.filter((edge) => edge.groupName === undefined).length, 1);
    assertEquals(edges.filter((edge) => edge.groupName === 'HD Group').length, 1);
  });
});

// ============================================================================
// E4: quality_definition -> quality (arr-scoped by table)
// ============================================================================

Deno.test(
  'E4 getOutgoingEdges(quality_definition) yields distinct radarr + sonarr edges for a shared quality',
  async () => {
    await withFixture(async (cache) => {
      const edges = await getOutgoingEdges(cache, { kind: 'quality_definition', name: 'Remux-2160p' });
      assertEquals(edges.length, 2);
      for (const edge of edges) {
        assertEquals(edge.from.kind, 'quality_definition');
        assertEquals(edge.from.name, 'Remux-2160p');
        assertEquals(edge.to.kind, 'quality');
        assertEquals(edge.to.name, 'Remux-2160p');
        assertEquals(edge.edgeKind, 'quality_definition_quality');
      }
      assertEquals(edges.map((edge) => edge.arrType).sort(), ['radarr', 'sonarr']);
    });
  }
);

Deno.test('E4 getIncomingEdges(quality) returns two distinct arr-scoped definitions for the same quality', async () => {
  await withFixture(async (cache) => {
    const edges = await getIncomingEdges(cache, { kind: 'quality', name: 'Remux-2160p' });
    // No profile references Remux-2160p, so only the E4 definition edges appear.
    assertEquals(edges.length, 2);
    for (const edge of edges) {
      assertEquals(edge.from.kind, 'quality_definition');
      assertEquals(edge.to.kind, 'quality');
      assertEquals(edge.to.name, 'Remux-2160p');
      assertEquals(edge.edgeKind, 'quality_definition_quality');
    }
    assertEquals(edges.map((edge) => edge.arrType).sort(), ['radarr', 'sonarr']);
  });
});

// ============================================================================
// Union
// ============================================================================

Deno.test('getAllEdges returns the union across E1-E4', async () => {
  await withFixture(async (cache) => {
    const edges = await getAllEdges(cache);
    const countByKind = (kind: string) => edges.filter((edge) => edge.edgeKind === kind).length;
    assertEquals(countByKind('quality_profile_custom_format'), 4);
    assertEquals(countByKind('custom_format_regular_expression'), 3);
    assertEquals(countByKind('quality_profile_quality'), 4);
    assertEquals(countByKind('quality_definition_quality'), 3);
    assertEquals(edges.length, 14);
    // 'all' survives in the union, never expanded into radarr/sonarr siblings.
    const allScoped = edges.filter(
      (edge) => edge.edgeKind === 'quality_profile_custom_format' && edge.arrType === 'all'
    );
    assertEquals(allScoped.length, 1);
  });
});
