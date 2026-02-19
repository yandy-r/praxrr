import { assertEquals, assertExists } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import { Kysely } from 'kysely';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createCacheFixture(seedSql: string): CacheFixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: sqlite,
    }),
  });

  sqlite.exec(seedSql);

  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
    },
  };
}

const BASE_SCHEMA_SQL = `
CREATE TABLE quality_profiles (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	description TEXT,
	upgrades_allowed INTEGER NOT NULL DEFAULT 1,
	minimum_custom_format_score INTEGER NOT NULL DEFAULT 0,
	upgrade_until_score INTEGER NOT NULL DEFAULT 0,
	upgrade_score_increment INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE quality_profile_tags (
	quality_profile_name TEXT NOT NULL,
	tag_name TEXT NOT NULL
);

CREATE TABLE tags (
	name TEXT NOT NULL PRIMARY KEY,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quality_profile_custom_formats (
	quality_profile_name TEXT NOT NULL,
	custom_format_name TEXT NOT NULL,
	arr_type TEXT NOT NULL,
	score INTEGER NOT NULL
);

CREATE TABLE quality_profile_qualities (
	quality_profile_name TEXT NOT NULL,
	quality_name TEXT,
	quality_group_name TEXT,
	position INTEGER NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	upgrade_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE qualities (
	id INTEGER NOT NULL PRIMARY KEY,
	name TEXT NOT NULL UNIQUE
);

CREATE TABLE quality_groups (
	quality_profile_name TEXT NOT NULL,
	name TEXT NOT NULL
);

CREATE TABLE quality_group_members (
	quality_profile_name TEXT NOT NULL,
	quality_group_name TEXT NOT NULL,
	quality_name TEXT NOT NULL
);

CREATE TABLE quality_profile_languages (
	quality_profile_name TEXT NOT NULL,
	language_name TEXT NOT NULL,
	type TEXT NOT NULL
);

CREATE TABLE languages (
	name TEXT NOT NULL PRIMARY KEY
);

CREATE TABLE quality_api_mappings (
	quality_name TEXT NOT NULL,
	arr_type TEXT NOT NULL,
	api_name TEXT NOT NULL
);
`;

Deno.test('qualityProfile list: lidarr scope returns only lidarr/all profiles with scoped counts', async () => {
  const fixture = createCacheFixture(`
${BASE_SCHEMA_SQL}
INSERT INTO qualities (id, name) VALUES (1, 'FLAC');
INSERT INTO qualities (id, name) VALUES (2, 'HDTV-1080p');
INSERT INTO qualities (id, name) VALUES (3, 'WEBDL-1080p');

INSERT INTO quality_profiles (id, name, description) VALUES
	(1, 'Lidarr Default', ''),
	(2, 'Sonarr HD', ''),
	(3, 'No Scores Yet', ''),
	(4, 'Disabled Lidarr Profile', ''),
	(5, 'Disabled Legacy Profile', '');

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, position, enabled, upgrade_until) VALUES
	('Lidarr Default', 'FLAC', 1, 1, 1),
	('Sonarr HD', 'HDTV-1080p', 1, 1, 1),
	('No Scores Yet', 'FLAC', 1, 1, 1),
	('Disabled Lidarr Profile', 'FLAC', 1, 0, 0),
	('Disabled Legacy Profile', 'HDTV-1080p', 1, 0, 0);

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
	('FLAC', 'lidarr', 'FLAC'),
	('Unknown', 'lidarr', 'Unknown'),
	('HDTV-1080p', 'sonarr', 'HDTV-1080p');

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
	('Lidarr Default', 'music-lossless', 'lidarr', 100),
	('Lidarr Default', 'global-priority', 'all', 50),
	('Disabled Lidarr Profile', 'music-disabled', 'lidarr', 5),
	('Sonarr HD', 'tv-hdr', 'all', 75);
`);

  try {
    const rows = await qualityProfileQueries.list(fixture.cache, 'lidarr');

    assertEquals(
      rows.map((row) => row.name),
      ['Disabled Lidarr Profile', 'Lidarr Default', 'No Scores Yet']
    );

    const lidarrDefault = rows.find((row) => row.name === 'Lidarr Default');
    assertExists(lidarrDefault);
    assertEquals(lidarrDefault.custom_formats.lidarr, 1);
    assertEquals(lidarrDefault.custom_formats.sonarr, 0);
    assertEquals(lidarrDefault.custom_formats.all, 1);
    assertEquals(lidarrDefault.custom_formats.total, 2);

    const noScoresYet = rows.find((row) => row.name === 'No Scores Yet');
    assertExists(noScoresYet);
    assertEquals(noScoresYet.custom_formats.lidarr, 0);
    assertEquals(noScoresYet.custom_formats.sonarr, 0);
    assertEquals(noScoresYet.custom_formats.all, 0);
    assertEquals(noScoresYet.custom_formats.total, 0);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('qualityProfile list: unscoped list keeps legacy behavior', async () => {
  const fixture = createCacheFixture(`
${BASE_SCHEMA_SQL}
INSERT INTO qualities (id, name) VALUES (1, 'FLAC');
INSERT INTO qualities (id, name) VALUES (2, 'HDTV-1080p');

INSERT INTO quality_profiles (id, name, description) VALUES
	(1, 'Lidarr Default', ''),
	(2, 'Sonarr HD', ''),
	(3, 'No Scores Yet', ''),
	(4, 'Disabled Lidarr Profile', ''),
	(5, 'Disabled Legacy Profile', '');

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, position, enabled, upgrade_until) VALUES
	('Lidarr Default', 'FLAC', 1, 1, 1),
	('Sonarr HD', 'HDTV-1080p', 1, 1, 1),
	('No Scores Yet', 'FLAC', 1, 1, 1),
	('Disabled Lidarr Profile', 'FLAC', 1, 0, 0),
	('Disabled Legacy Profile', 'HDTV-1080p', 1, 0, 0);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
	('Lidarr Default', 'music-lossless', 'lidarr', 100),
	('Disabled Lidarr Profile', 'music-disabled', 'lidarr', 5),
	('Sonarr HD', 'tv-hdr', 'sonarr', 75);
`);

  try {
    const rows = await qualityProfileQueries.list(fixture.cache);

    assertEquals(
      rows.map((row) => row.name),
      ['Disabled Legacy Profile', 'Disabled Lidarr Profile', 'Lidarr Default', 'No Scores Yet', 'Sonarr HD']
    );

    const noScores = rows.find((row) => row.name === 'No Scores Yet');
    assertExists(noScores);
    assertEquals(noScores.custom_formats.total, 0);
  } finally {
    await fixture.destroy();
  }
});
