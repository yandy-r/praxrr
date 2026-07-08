import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { getQualityCompatibility, getQualityProfileCompatibility } from '$pcd/graph/compat.ts';

// Compatibility annotation guard for the dependency-graph node stamping. compat.ts must:
//   - derive quality compatibility purely from quality_api_mappings (ARR_APP_TYPES order), and
//   - derive quality-profile compatibility via computeProfileCompatibility (enabled qualities +
//     the all-disabled arr-specific-score fallback), NEVER via arr_type='all' score inference.
// The fixture uses REAL QUALITIES api/quality names (radarr SDTV/REGIONAL) so the intersection in
// computeCompatibleProfileNames (Object.keys(QUALITIES[arrType]) ∩ quality_api_mappings) is non-empty.
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
CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  api_name TEXT NOT NULL,
  arr_type TEXT NOT NULL
);

CREATE TABLE quality_profiles (
  name TEXT PRIMARY KEY
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

CREATE TABLE quality_profile_custom_formats (
  quality_profile_name TEXT NOT NULL,
  custom_format_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (quality_profile_name, custom_format_name, arr_type)
);

-- SDTV exists in QUALITIES for both radarr and sonarr; REGIONAL is a radarr-only quality.
INSERT INTO quality_api_mappings (quality_name, api_name, arr_type) VALUES
  ('SDTV', 'SDTV', 'radarr'),
  ('SDTV', 'SDTV', 'sonarr'),
  ('REGIONAL', 'REGIONAL', 'radarr');

INSERT INTO quality_profiles (name) VALUES
  ('Radarr Only Profile'),
  ('All Disabled Radarr Score Profile'),
  ('All Disabled All-Score Profile');

-- Radarr Only Profile: one enabled radarr-only quality (REGIONAL).
-- The other two profiles carry the SAME quality but DISABLED, exercising the all-disabled branch.
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, enabled) VALUES
  ('Radarr Only Profile', 'REGIONAL', NULL, 1),
  ('All Disabled Radarr Score Profile', 'SDTV', NULL, 0),
  ('All Disabled All-Score Profile', 'SDTV', NULL, 0);

-- Scores: an arr_type='all' score must never confer compatibility on its own.
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
  ('Radarr Only Profile', 'CF All', 'all', 25),
  ('All Disabled Radarr Score Profile', 'CF Radarr', 'radarr', 100),
  ('All Disabled All-Score Profile', 'CF All', 'all', 50);
`;

function withFixture(fn: (cache: PCDCache) => Promise<void>): Promise<void> {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  return fn(fixture.cache).finally(fixture.destroy);
}

Deno.test('getQualityCompatibility maps each quality to its supporting Arr apps in ARR_APP_TYPES order', async () => {
  await withFixture(async (cache) => {
    const compat = await getQualityCompatibility(cache);

    // Present for radarr + sonarr (not lidarr) -> filtered to ARR_APP_TYPES order.
    assertEquals(compat.get('SDTV'), ['radarr', 'sonarr']);
    // Present for radarr only.
    assertEquals(compat.get('REGIONAL'), ['radarr']);
  });
});

Deno.test(
  'getQualityProfileCompatibility derives from enabled qualities, not arr_type=all score inference',
  async () => {
    await withFixture(async (cache) => {
      const compat = await getQualityProfileCompatibility(cache);

      // Enabled quality REGIONAL is radarr-only -> compatible with radarr and nothing else,
      // even though the profile owns an arr_type='all' score (which must be ignored).
      assertEquals(compat.get('Radarr Only Profile'), ['radarr']);

      // A profile whose only score is arr_type='all' and whose qualities are all disabled
      // must NOT be considered compatible with any Arr (no arr_type='all' inference).
      assertEquals(compat.get('All Disabled All-Score Profile'), []);
      assert(!compat.get('All Disabled All-Score Profile')!.includes('radarr'));
    });
  }
);

Deno.test(
  'getQualityProfileCompatibility keeps all-disabled profiles that own an arr-specific score (CLAUDE.md guardrail)',
  async () => {
    await withFixture(async (cache) => {
      const compat = await getQualityProfileCompatibility(cache);

      // All qualities disabled, but the profile owns an arr_type='radarr' custom-format score,
      // so it stays radarr-compatible via the all-disabled fallback (and only radarr).
      assertEquals(compat.get('All Disabled Radarr Score Profile'), ['radarr']);
    });
  }
);
