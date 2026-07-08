import { assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { getCustomFormatDependentScores, getRegularExpressionDependentConditions } from '$pcd/graph/references.ts';

// Op-equivalence regression guard for the Phase 4 DRY refactor: the reverse-dependency
// readers extracted from customFormats/delete.ts, customFormats/general/update.ts, and
// regularExpressions/delete.ts must return the EXACT rows (columns + order) those handlers
// relied on, so op generation stays byte-identical after they switch to consuming these
// readers. Fixture recipe mirrors resolved/readers.test.ts.
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

-- Two custom formats scored across profiles/arrs; CF2 must never appear for CF1.
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
  ('Profile B', 'CF1', 'radarr', 100),
  ('Profile A', 'CF1', 'sonarr', 50),
  ('Profile A', 'CF1', 'radarr', 10),
  ('Profile A', 'CF1', 'all', 25),
  ('Profile A', 'CF2', 'radarr', 5);

-- Two conditions referencing RE1 across two custom formats, with distinct arr_type/value-guard columns.
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required) VALUES
  ('CFY', 'c2', 'release_title', 'all', 1, 0),
  ('CFX', 'c1', 'release_title', 'radarr', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES
  ('CFY', 'c2', 'RE1'),
  ('CFX', 'c1', 'RE1'),
  ('CFX', 'c1', 'RE2');
`;

function withFixture(fn: (cache: PCDCache) => Promise<void>): Promise<void> {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  return fn(fixture.cache).finally(fixture.destroy);
}

Deno.test('getCustomFormatDependentScores returns only the target CF rows with the value-guard columns', async () => {
  await withFixture(async (cache) => {
    const rows = await getCustomFormatDependentScores(cache, 'CF1');
    assertEquals(rows.length, 4);
    for (const row of rows) {
      assertEquals(row.custom_format_name, 'CF1');
      // exact column set the delete/update handlers destructure
      assertEquals(Object.keys(row).sort(), ['arr_type', 'custom_format_name', 'quality_profile_name', 'score']);
    }
  });
});

Deno.test(
  'getCustomFormatDependentScores applies the delete.ts order (quality_profile_name, arr_type) when requested',
  async () => {
    await withFixture(async (cache) => {
      const rows = await getCustomFormatDependentScores(cache, 'CF1', {
        orderBy: ['quality_profile_name', 'arr_type'],
      });
      const ordered = rows.map((row) => `${row.quality_profile_name}/${row.arr_type}/${Number(row.score)}`);
      assertEquals(ordered, ['Profile A/all/25', 'Profile A/radarr/10', 'Profile A/sonarr/50', 'Profile B/radarr/100']);
    });
  }
);

Deno.test(
  'getCustomFormatDependentScores without orderBy returns the full set (update.ts relies on Map insertion order, not SQL order)',
  async () => {
    await withFixture(async (cache) => {
      const rows = await getCustomFormatDependentScores(cache, 'CF1');
      const asSet = new Set(rows.map((row) => `${row.quality_profile_name}/${row.arr_type}/${Number(row.score)}`));
      assertEquals(
        asSet,
        new Set(['Profile A/all/25', 'Profile A/radarr/10', 'Profile A/sonarr/50', 'Profile B/radarr/100'])
      );
    });
  }
);

Deno.test(
  'getRegularExpressionDependentConditions returns the 6-column superset ordered by (custom_format_name, condition_name)',
  async () => {
    await withFixture(async (cache) => {
      const rows = await getRegularExpressionDependentConditions(cache, 'RE1');
      assertEquals(rows.length, 2);
      assertEquals(
        rows.map((row) => `${row.custom_format_name}/${row.condition_name}`),
        ['CFX/c1', 'CFY/c2']
      );
      // value-guard columns sourced from the parent condition (condition_patterns has no arr_type)
      assertEquals(rows[0].arr_type, 'radarr');
      assertEquals(rows[0].type, 'release_title');
      assertEquals(Number(rows[0].negate), 0);
      assertEquals(Number(rows[0].required), 1);
      assertEquals(rows[1].arr_type, 'all');
      assertEquals(Number(rows[1].negate), 1);
      assertEquals(Object.keys(rows[0]).sort(), [
        'arr_type',
        'condition_name',
        'custom_format_name',
        'negate',
        'required',
        'type',
      ]);
    });
  }
);
