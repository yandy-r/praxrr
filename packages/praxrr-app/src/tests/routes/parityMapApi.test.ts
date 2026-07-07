// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { setCache, deleteCache } from '$pcd/database/registry.ts';
import { GET } from '../../routes/api/v1/compatibility/parity/+server.ts';
import type { components } from '$api/v1.d.ts';

type GetEvent = Parameters<typeof GET>[0];
type ParityMapResponse = components['schemas']['ParityMapResponse'];
type ErrorResponse = components['schemas']['ErrorResponse'];

function buildGetEvent(query: string, authenticated: boolean): GetEvent {
  const event: Partial<GetEvent> = {
    url: new URL(`http://localhost/api/v1/compatibility/parity${query}`),
    locals: authenticated
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
        },
  };

  return event as GetEvent;
}

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

// Mirrors qualityProfileCompatibility.test.ts's fixture: an in-memory PCDCache
// covering the tables computeProfileCompatibility() reads (quality_api_mappings,
// quality_profiles, quality_profile_qualities, quality_group_members,
// quality_profile_custom_formats). `isBuilt: () => true` is added on top since the
// parity endpoint gates on `cache?.isBuilt()` before computing compatibility.
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
CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE quality_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  upgrades_allowed INTEGER NOT NULL DEFAULT 1,
  minimum_custom_format_score INTEGER NOT NULL DEFAULT 0,
  upgrade_until_score INTEGER NOT NULL DEFAULT 0,
  upgrade_score_increment INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE quality_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quality_profile_name TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE quality_group_members (
  quality_profile_name TEXT NOT NULL,
  quality_group_name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  PRIMARY KEY (quality_profile_name, quality_group_name, quality_name)
);

CREATE TABLE quality_profile_qualities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quality_profile_name TEXT NOT NULL,
  quality_name TEXT,
  quality_group_name TEXT,
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  upgrade_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE quality_profile_custom_formats (
  quality_profile_name TEXT NOT NULL,
  custom_format_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (quality_profile_name, custom_format_name, arr_type)
);

INSERT INTO quality_profiles (id, name) VALUES
  (1, 'Video-Profile'),
  (2, 'Audio-Profile'),
  (3, 'Score-Only-Profile');

-- Video-Profile: enabled quality is a QUALITIES.radarr/QUALITIES.sonarr key, not a lidarr one.
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled) VALUES
  ('Video-Profile', 'Bluray-1080p', NULL, 0, 1),
  ('Audio-Profile', 'FLAC', NULL, 0, 1);

-- Score-Only-Profile has no enabled quality rows -- compatible via the arr-specific
-- custom-format-score fallback only (radarr).
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
  ('Score-Only-Profile', 'SomeCF', 'radarr', 10);
`;

Deno.test(
  'authenticated parity map request with no databaseId returns the static matrix without profiles',
  async () => {
    const response = await GET(buildGetEvent('', true));
    assertEquals(response.status, 200);

    const body = (await response.json()) as ParityMapResponse;
    assertEquals(body.matrix.length, 5);
    assert(body.semanticDifferences.length >= 8);
    assertEquals(body.profiles, undefined);
  }
);

Deno.test('authenticated parity map request with a built cache returns per-profile compatibility', async () => {
  const databaseId = 424242;
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);

  try {
    setCache(databaseId, fixture.cache);

    const response = await GET(buildGetEvent(`?databaseId=${databaseId}`, true));
    assertEquals(response.status, 200);

    const body = (await response.json()) as ParityMapResponse;
    assert(body.profiles);
    assert(body.profiles.length > 0);

    for (const profile of body.profiles) {
      assert(Array.isArray(profile.compatibleArrTypes));
      assertEquals(profile.basis, 'enabled-qualities');
    }

    const byName = new Map(body.profiles.map((profile) => [profile.name, profile]));
    assertEquals(byName.get('Video-Profile')?.compatibleArrTypes, ['radarr', 'sonarr']);
    assertEquals(byName.get('Audio-Profile')?.compatibleArrTypes, ['lidarr']);
    assertEquals(byName.get('Score-Only-Profile')?.compatibleArrTypes, ['radarr']);
  } finally {
    deleteCache(databaseId);
    await fixture.destroy();
  }
});

Deno.test('authenticated parity map request rejects invalid or unresolvable databaseId with 400', async () => {
  const invalidQueries = ['?databaseId=abc', '?databaseId=all', '?databaseId=999999999'];

  for (const query of invalidQueries) {
    const response = await GET(buildGetEvent(query, true));
    assertEquals(response.status, 400);

    const body = (await response.json()) as ErrorResponse;
    assert(typeof body.error === 'string' && body.error.length > 0);
  }
});

Deno.test('unauthenticated parity map request returns 401', async () => {
  const response = await GET(buildGetEvent('', false));
  assertEquals(response.status, 401);

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});
