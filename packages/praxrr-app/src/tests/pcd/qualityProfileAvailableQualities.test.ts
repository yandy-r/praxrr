import { assertEquals, assertFalse } from '@std/assert';
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

const SCHEMA_SQL = `
CREATE TABLE quality_profiles (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE
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

CREATE TABLE quality_api_mappings (
	quality_name TEXT NOT NULL,
	arr_type TEXT NOT NULL,
	api_name TEXT NOT NULL
);

INSERT INTO qualities (id, name) VALUES
	(1, 'Bluray-1080p'),
	(2, 'WEBDL-1080p'),
	(3, 'HDTV-720p'),
	(4, 'DVDSCR'),
	(5, 'Remux-1080p'),
	(6, 'FLAC'),
	(7, 'MP3-320'),
	(8, 'ALAC');

-- 'Remux-1080p' is not a QUALITIES.sonarr key: Sonarr support comes only from the api_name mapping.
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
	('Bluray-1080p', 'radarr', 'Bluray-1080p'),
	('Bluray-1080p', 'sonarr', 'Bluray-1080p'),
	('WEBDL-1080p', 'radarr', 'WEBDL-1080p'),
	('WEBDL-1080p', 'sonarr', 'WEBDL-1080p'),
	('HDTV-720p', 'radarr', 'HDTV-720p'),
	('HDTV-720p', 'sonarr', 'HDTV-720p'),
	('DVDSCR', 'radarr', 'DVDSCR'),
	('Remux-1080p', 'radarr', 'Remux-1080p'),
	('Remux-1080p', 'sonarr', 'Bluray-1080p Remux'),
	('FLAC', 'lidarr', 'FLAC'),
	('MP3-320', 'lidarr', 'MP3-320'),
	('ALAC', 'lidarr', 'ALAC');
`;

async function loadEditorData(seedSql: string, profileName: string) {
  const fixture = createCacheFixture(`${SCHEMA_SQL}\n${seedSql}`);
  try {
    const ladder = await qualityProfileQueries.qualities(fixture.cache, 1, profileName);
    const result = await qualityProfileQueries.availableQualityCandidates(fixture.cache, profileName, ladder);
    return { ladder, result, available: result.candidates.map((quality) => quality.name) };
  } finally {
    await fixture.destroy();
  }
}

Deno.test('availableQualityCandidates: radarr-only profile offers radarr additions only', async () => {
  // DVDSCR is Radarr-only, so this profile is compatible with Radarr and not Sonarr/Lidarr.
  const { ladder, available } = await loadEditorData(
    `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Movies HD');
INSERT INTO quality_groups (quality_profile_name, name) VALUES ('Movies HD', 'HD Web');
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES
	('Movies HD', 'HD Web', 'WEBDL-1080p');
INSERT INTO quality_profile_qualities
	(quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
VALUES
	('Movies HD', 'Bluray-1080p', NULL, 1, 1, 1),
	('Movies HD', NULL, 'HD Web', 2, 1, 0),
	('Movies HD', 'DVDSCR', NULL, 3, 1, 0);
`,
    'Movies HD'
  );

  assertEquals(available, ['HDTV-720p', 'Remux-1080p']);
  for (const audioQuality of ['FLAC', 'MP3-320', 'ALAC']) {
    assertFalse(available.includes(audioQuality), `${audioQuality} must not be offered`);
  }
  assertEquals(
    ladder.orderedItems.map((item) => item.name),
    ['Bluray-1080p', 'HD Web', 'DVDSCR']
  );
  assertEquals(ladder.allQualities.length, 8);
  // qualities() stays a plain ladder read; candidates are computed only for the editor.
  assertFalse('availableQualities' in ladder);
});

Deno.test('availableQualityCandidates: radarr+sonarr profile offers the union of both apps', async () => {
  const { result, available } = await loadEditorData(
    `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Shared HD');
INSERT INTO quality_profile_qualities
	(quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
VALUES
	('Shared HD', 'Bluray-1080p', NULL, 1, 1, 1),
	('Shared HD', 'HDTV-720p', NULL, 2, 1, 0);
`,
    'Shared HD'
  );

  // DVDSCR is Radarr-only yet offered: the profile syncs to Radarr, so it is a valid addition there.
  assertEquals(available, ['DVDSCR', 'Remux-1080p', 'WEBDL-1080p']);
  assertFalse(available.includes('FLAC'));
  assertEquals(result.targetArrTypes, ['radarr', 'sonarr']);
  // Each candidate lists the target apps supporting it (DVDSCR is Radarr-only).
  assertEquals(result.candidates, [
    { name: 'DVDSCR', arrTypes: ['radarr'] },
    { name: 'Remux-1080p', arrTypes: ['radarr', 'sonarr'] },
    { name: 'WEBDL-1080p', arrTypes: ['radarr', 'sonarr'] },
  ]);
  assertFalse(result.arrTargetUnresolved);
});

Deno.test('availableQualityCandidates: sonarr score-only profile resolves support via api_name mapping', async () => {
  const { available } = await loadEditorData(
    `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Series Scores');
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
	('Series Scores', 'Some CF', 'sonarr', 100);
`,
    'Series Scores'
  );

  // Remux-1080p is Sonarr-supported only through ('Remux-1080p', 'sonarr', 'Bluray-1080p Remux').
  assertEquals(available, ['Bluray-1080p', 'HDTV-720p', 'Remux-1080p', 'WEBDL-1080p']);
  assertFalse(available.includes('DVDSCR'));
  assertFalse(available.includes('FLAC'));
});

Deno.test('availableQualityCandidates: radarr score-only profile offers radarr additions only', async () => {
  const { available } = await loadEditorData(
    `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Radarr Scores');
INSERT INTO quality_profile_qualities
	(quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
VALUES
	('Radarr Scores', 'Bluray-1080p', NULL, 1, 0, 0);
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
	('Radarr Scores', 'Some CF', 'radarr', 100),
	('Radarr Scores', 'Shared CF', 'all', 50);
`,
    'Radarr Scores'
  );

  assertEquals(available, ['DVDSCR', 'HDTV-720p', 'Remux-1080p', 'WEBDL-1080p']);
  for (const audioQuality of ['FLAC', 'MP3-320', 'ALAC']) {
    assertFalse(available.includes(audioQuality), `${audioQuality} must not be offered`);
  }
});

Deno.test('availableQualityCandidates: lidarr profile excludes video-only additions', async () => {
  const { available } = await loadEditorData(
    `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Lossless');
INSERT INTO quality_profile_qualities
	(quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
VALUES
	('Lossless', 'FLAC', NULL, 1, 1, 1);
`,
    'Lossless'
  );

  assertEquals(available, ['ALAC', 'MP3-320']);
  for (const videoQuality of ['Bluray-1080p', 'WEBDL-1080p', 'HDTV-720p', 'DVDSCR', 'Remux-1080p']) {
    assertFalse(available.includes(videoQuality), `${videoQuality} must not be offered`);
  }
});

Deno.test(
  'availableQualityCandidates: all-disabled ladder without scores resolves apps from stored names',
  async () => {
    const { result, available } = await loadEditorData(
      `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Disabled Movies');
INSERT INTO quality_profile_qualities
	(quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
VALUES
	('Disabled Movies', 'Bluray-1080p', NULL, 1, 0, 0),
	('Disabled Movies', 'DVDSCR', NULL, 2, 0, 0);
`,
      'Disabled Movies'
    );

    // No enabled qualities and no arr-specific scores: Radarr is the only app supporting every stored name.
    assertEquals(result.targetArrTypes, ['radarr']);
    assertEquals(available, ['HDTV-720p', 'Remux-1080p', 'WEBDL-1080p']);
    assertFalse(result.arrTargetUnresolved);
  }
);

Deno.test('availableQualityCandidates: empty ladder with only all-app scores is unresolved', async () => {
  const { ladder, result } = await loadEditorData(
    `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Blank');
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES
	('Blank', 'Shared CF', 'all', 50);
`,
    'Blank'
  );

  assertEquals(ladder.orderedItems, []);
  assertEquals(result, { candidates: [], targetArrTypes: [], arrTargetUnresolved: true });
});

Deno.test('availableQualityCandidates: mixed-app ladder resolves no app and offers no additions', async () => {
  const { ladder, result, available } = await loadEditorData(
    `
INSERT INTO quality_profiles (id, name) VALUES (1, 'Mixed');
INSERT INTO quality_profile_qualities
	(quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
VALUES
	('Mixed', 'Bluray-1080p', NULL, 1, 1, 1),
	('Mixed', 'FLAC', NULL, 2, 1, 0),
	('Mixed', 'HDTV-720p', NULL, 3, 0, 0);
`,
    'Mixed'
  );

  // The stored-name fallback cannot rescue a ladder no single app fully supports.
  assertEquals(available, []);
  assertEquals(result.arrTargetUnresolved, true);
  assertEquals(
    ladder.orderedItems.map((item) => ({ name: item.name, enabled: item.enabled })),
    [
      { name: 'Bluray-1080p', enabled: true },
      { name: 'FLAC', enabled: true },
      { name: 'HDTV-720p', enabled: false },
    ]
  );
});

Deno.test('availableQualityCandidates: no unused qualities short-circuits without querying', async () => {
  // A cache whose kb is unusable proves no compatibility queries run.
  const cache = { kb: undefined } as unknown as PCDCache;
  const candidates = await qualityProfileQueries.availableQualityCandidates(cache, 'Full', {
    orderedItems: [
      { type: 'quality', name: 'Bluray-1080p', position: 1, enabled: true, upgradeUntil: true },
      {
        type: 'group',
        name: 'HD Web',
        position: 2,
        enabled: true,
        upgradeUntil: false,
        members: [{ name: 'WEBDL-1080p' }],
      },
    ],
    allQualities: [{ name: 'Bluray-1080p' }, { name: 'WEBDL-1080p' }],
  });

  assertEquals(candidates, { candidates: [], targetArrTypes: [], arrTargetUnresolved: false });
});
