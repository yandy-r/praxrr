/**
 * Tests for `materializeQualityFacts` (issue #221): exact-case PCD fact names + fail-fast 422.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { materializeQualityFacts } from '$server/goals/materializeQualityFacts.ts';

const PCD_SCHEMA_SQL_PATH = new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

interface Fixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createFixture(seed: string): Fixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: sqlite }) });
  sqlite.exec(PCD_SCHEMA_SQL);
  sqlite.exec(seed);
  return {
    cache: { kb } as PCDCache,
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
    }
  };
}

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err ? (err as { status: number }).status : undefined;
}

Deno.test('materializeQualityFacts: Sonarr remux fact uses the PCD name (not the API name) and its resolution', async () => {
  const fixture = createFixture(`
    INSERT INTO qualities (name) VALUES ('Remux-1080p'), ('Bluray-1080p'), ('HDTV-720p');
    INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
      ('Remux-1080p', 'sonarr', 'Bluray-1080p Remux'),
      ('Bluray-1080p', 'sonarr', 'Bluray-1080p'),
      ('HDTV-720p', 'sonarr', 'HDTV-720p');
  `);
  try {
    const facts = await materializeQualityFacts(fixture.cache, 'sonarr');
    const remux = facts.find((fact) => fact.name === 'Remux-1080p');
    assert(remux, 'expected a fact keyed by the PCD name Remux-1080p, not the API name');
    assertEquals(remux.resolution, 1080);
    assert(!facts.some((fact) => fact.name === 'Bluray-1080p Remux'), 'must not use the arr API name');

    const seven20 = facts.find((fact) => fact.name === 'HDTV-720p');
    assertEquals(seven20?.resolution, 720);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('materializeQualityFacts: native lidarr audio mappings materialize (resolution 0) without a false 422 (#222)', async () => {
  const fixture = createFixture(`
    INSERT INTO qualities (name) VALUES ('FLAC'), ('MP3-320'), ('AAC-256');
    INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
      ('FLAC', 'lidarr', 'FLAC'),
      ('MP3-320', 'lidarr', 'MP3-320'),
      ('AAC-256', 'lidarr', 'AAC-256');
  `);
  try {
    const facts = await materializeQualityFacts(fixture.cache, 'lidarr');
    assertEquals(facts.length, 3);
    // Audio qualities carry resolution 0 (no video resolution) and must NOT trigger the 422 path.
    assert(facts.every((fact) => fact.resolution === 0));
    assert(facts.some((fact) => fact.name === 'FLAC'));
  } finally {
    await fixture.destroy();
  }
});

Deno.test('materializeQualityFacts: an api_name with no known resolution fails fast with 422', async () => {
  const fixture = createFixture(`
    INSERT INTO qualities (name) VALUES ('Bluray-1080p'), ('Mystery-Quality');
    INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
      ('Bluray-1080p', 'sonarr', 'Bluray-1080p'),
      ('Mystery-Quality', 'sonarr', 'Totally-Unknown-API-Name');
  `);
  try {
    const err = await assertRejects(() => materializeQualityFacts(fixture.cache, 'sonarr'));
    assertEquals(statusOf(err), 422);
  } finally {
    await fixture.destroy();
  }
});
