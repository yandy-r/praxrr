/**
 * Quality profile / Arr-type compatibility
 *
 * Covers `computeCompatibleProfileNames` / `computeProfileCompatibility` (compatibility.ts)
 * and confirms `list.ts` delegates to them correctly for both compatibility bases:
 * enabled-qualities matching and the zero-enabled arr-specific-score fallback.
 */

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { ArrAppType } from '$shared/arr/capabilities.ts';
import {
  computeCompatibleProfileNames,
  computeProfileCompatibility,
} from '$pcd/entities/qualityProfiles/compatibility.ts';
import { list } from '$pcd/entities/qualityProfiles/list.ts';

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(schemaAndDataSql);

  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

// Fixture profiles cover the two compatibility bases in computeCompatibleProfileNames:
// - Video-Profile / Audio-Profile / Legacy-Lidarr-Profile exercise the enabled-qualities path.
// - Score-Only-Profile has zero enabled qualities and exercises the arr-specific-score fallback.
const SCHEMA_AND_DATA_SQL = `
CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE qualities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
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

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quality_profile_tags (
  quality_profile_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  PRIMARY KEY (quality_profile_name, tag_name)
);

CREATE TABLE languages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE quality_profile_languages (
  quality_profile_name TEXT NOT NULL,
  language_name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'simple',
  PRIMARY KEY (quality_profile_name, language_name)
);

-- Transitional pre-20260216 Lidarr mapping: api_name is not a QUALITIES.lidarr key,
-- so it must be filtered out of the compatible-quality-names set entirely.
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
  ('LegacyLidarrQuality', 'lidarr', 'LegacyApiName');

INSERT INTO quality_profiles (id, name) VALUES
  (1, 'Video-Profile'),
  (2, 'Audio-Profile'),
  (3, 'Score-Only-Profile'),
  (4, 'Legacy-Lidarr-Profile');

-- Video-Profile: enabled quality is a QUALITIES.radarr/QUALITIES.sonarr key, not a lidarr one.
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled) VALUES
  ('Video-Profile', 'Bluray-1080p', NULL, 0, 1),
  ('Audio-Profile', 'FLAC', NULL, 0, 1),
  ('Legacy-Lidarr-Profile', 'LegacyLidarrQuality', NULL, 0, 1);

-- Score-Only-Profile has no enabled quality rows at all -- it can only become compatible
-- through the arr-specific custom-format-score fallback below (radarr only).
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
  ('Score-Only-Profile', 'SomeCF', 'radarr', 10);
`;

const ALL_ARR_TYPES: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

Deno.test('computeCompatibleProfileNames: video quality matches radarr/sonarr but not lidarr', async () => {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  try {
    const radarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'radarr');
    const sonarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'sonarr');
    const lidarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'lidarr');

    assert(radarrCompatible.has('Video-Profile'));
    assert(sonarrCompatible.has('Video-Profile'));
    assert(!lidarrCompatible.has('Video-Profile'));
  } finally {
    await fixture.destroy();
  }
});

Deno.test('computeCompatibleProfileNames: audio quality (FLAC) matches lidarr only', async () => {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  try {
    const radarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'radarr');
    const sonarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'sonarr');
    const lidarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'lidarr');

    assert(!radarrCompatible.has('Audio-Profile'));
    assert(!sonarrCompatible.has('Audio-Profile'));
    assert(lidarrCompatible.has('Audio-Profile'));
  } finally {
    await fixture.destroy();
  }
});

Deno.test(
  'computeCompatibleProfileNames: zero-enabled profile is compatible via the arr-specific-score fallback',
  async () => {
    const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
    try {
      const radarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'radarr');
      const sonarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'sonarr');
      const lidarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'lidarr');

      assert(radarrCompatible.has('Score-Only-Profile'));
      assert(!sonarrCompatible.has('Score-Only-Profile'));
      assert(!lidarrCompatible.has('Score-Only-Profile'));
    } finally {
      await fixture.destroy();
    }
  }
);

Deno.test(
  'computeCompatibleProfileNames: transitional Lidarr mapping with an unknown api_name is excluded by the QUALITIES filter',
  async () => {
    const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
    try {
      const radarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'radarr');
      const sonarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'sonarr');
      const lidarrCompatible = await computeCompatibleProfileNames(fixture.cache, 'lidarr');

      assert(!radarrCompatible.has('Legacy-Lidarr-Profile'));
      assert(!sonarrCompatible.has('Legacy-Lidarr-Profile'));
      assert(!lidarrCompatible.has('Legacy-Lidarr-Profile'));
    } finally {
      await fixture.destroy();
    }
  }
);

Deno.test('computeProfileCompatibility: summarizes per-profile compatibility across all Arr types', async () => {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  try {
    const perProfile = await computeProfileCompatibility(fixture.cache);

    assertEquals(
      perProfile.map((profile) => profile.name),
      ['Audio-Profile', 'Legacy-Lidarr-Profile', 'Score-Only-Profile', 'Video-Profile']
    );

    const byName = new Map(perProfile.map((profile) => [profile.name, profile]));
    assertEquals(byName.get('Video-Profile')?.compatibleArrTypes, ['radarr', 'sonarr']);
    assertEquals(byName.get('Audio-Profile')?.compatibleArrTypes, ['lidarr']);
    assertEquals(byName.get('Score-Only-Profile')?.compatibleArrTypes, ['radarr']);
    assertEquals(byName.get('Legacy-Lidarr-Profile')?.compatibleArrTypes, []);

    for (const profile of perProfile) {
      assertEquals(profile.basis, 'enabled-qualities');
    }
  } finally {
    await fixture.destroy();
  }
});

Deno.test(
  'list(cache, arrType) delegates to computeCompatibleProfileNames() for both the enabled-qualities and score-fallback bases',
  async () => {
    const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
    try {
      for (const arrType of ALL_ARR_TYPES) {
        const compatibleNames = await computeCompatibleProfileNames(fixture.cache, arrType);
        const listed = await list(fixture.cache, arrType);

        assertEquals(listed.map((row) => row.name).sort(), [...compatibleNames].sort());
      }
    } finally {
      await fixture.destroy();
    }
  }
);
