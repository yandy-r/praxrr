import { assertEquals, assertExists } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import { Kysely } from 'kysely';
import type { PCDCache } from '$pcd/index.ts';
import {
  getLidarrDefaults,
  getRadarrDefaults,
  getSonarrDefaults,
} from '$pcd/entities/mediaManagement/naming/read.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

type NamingArrType = 'radarr' | 'sonarr' | 'lidarr';

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createCacheFixture(extraInserts = ''): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(`
CREATE TABLE IF NOT EXISTS radarr_naming (
  name TEXT NOT NULL PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 1,
  movie_format TEXT NOT NULL,
  movie_folder_format TEXT NOT NULL,
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format TEXT NOT NULL DEFAULT 'smart',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sonarr_naming (
  name TEXT NOT NULL PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 1,
  standard_episode_format TEXT NOT NULL,
  daily_episode_format TEXT NOT NULL,
  anime_episode_format TEXT NOT NULL,
  series_folder_format TEXT NOT NULL,
  season_folder_format TEXT NOT NULL,
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format INTEGER NOT NULL DEFAULT 4,
  custom_colon_replacement_format TEXT,
  multi_episode_style INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_naming (
  name TEXT NOT NULL PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 1,
  standard_track_format TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  multi_disc_track_format TEXT NOT NULL,
  artist_folder_format TEXT NOT NULL,
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format INTEGER NOT NULL DEFAULT 4,
  custom_colon_replacement_format TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

${extraInserts}
`);

  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function insertNamingRow(arrType: NamingArrType, name: string, createdAt: string): string {
  const updatedAt = createdAt;

  if (arrType === 'radarr') {
    return `
INSERT INTO radarr_naming (
  name,
  rename,
  movie_format,
  movie_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  created_at,
  updated_at
) VALUES (
  '${name}',
  1,
  'movie-format',
  'movie-folder-format',
  1,
  'smart',
  '${createdAt}',
  '${updatedAt}'
);`;
  }

  if (arrType === 'sonarr') {
    return `
INSERT INTO sonarr_naming (
  name,
  rename,
  standard_episode_format,
  daily_episode_format,
  anime_episode_format,
  series_folder_format,
  season_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  custom_colon_replacement_format,
  multi_episode_style,
  created_at,
  updated_at
) VALUES (
  '${name}',
  1,
  'standard-episode-format',
  'daily-episode-format',
  'anime-episode-format',
  'series-folder-format',
  'season-folder-format',
  1,
  4,
  NULL,
  0,
  '${createdAt}',
  '${updatedAt}'
);`;
  }

  return `
INSERT INTO lidarr_naming (
  name,
  rename,
  standard_track_format,
  artist_name,
  multi_disc_track_format,
  artist_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  custom_colon_replacement_format,
  created_at,
  updated_at
) VALUES (
  '${name}',
  1,
  'standard-track-format',
  'artist-name',
  'multi-disc-track-format',
  'artist-folder-format',
  1,
  4,
  NULL,
  '${createdAt}',
  '${updatedAt}'
);`;
}

async function getDefaultsByArrType(
  cache: PCDCache,
  arrType: NamingArrType
): Promise<{ name: string } | null> {
  if (arrType === 'radarr') {
    return await getRadarrDefaults(cache);
  }

  if (arrType === 'sonarr') {
    return await getSonarrDefaults(cache);
  }

  return await getLidarrDefaults(cache);
}

const ARR_TYPES: NamingArrType[] = ['radarr', 'sonarr', 'lidarr'];

for (const arrType of ARR_TYPES) {
  Deno.test(`${arrType} defaults prefer name=default case-insensitively`, async () => {
    const fixture = createCacheFixture(`
${insertNamingRow(arrType, 'legacy-row', '2024-01-01T00:00:00.000Z')}
${insertNamingRow(arrType, arrType.toUpperCase(), '2023-01-01T00:00:00.000Z')}
${insertNamingRow(arrType, 'DEFAULT', '2025-01-01T00:00:00.000Z')}
`);

    try {
      const defaults = await getDefaultsByArrType(fixture.cache, arrType);
      assertExists(defaults);
      assertEquals(defaults.name, 'DEFAULT');
    } finally {
      await fixture.destroy();
    }
  });

  Deno.test(`${arrType} defaults fall back to arr-type name when default is missing`, async () => {
    const fixture = createCacheFixture(`
${insertNamingRow(arrType, 'oldest-non-match', '2020-01-01T00:00:00.000Z')}
${insertNamingRow(arrType, arrType.toUpperCase(), '2025-01-01T00:00:00.000Z')}
`);

    try {
      const defaults = await getDefaultsByArrType(fixture.cache, arrType);
      assertExists(defaults);
      assertEquals(defaults.name, arrType.toUpperCase());
    } finally {
      await fixture.destroy();
    }
  });

  Deno.test(`${arrType} defaults fall back to oldest row when no named match exists`, async () => {
    const fixture = createCacheFixture(`
${insertNamingRow(arrType, 'newer-row', '2025-01-01T00:00:00.000Z')}
${insertNamingRow(arrType, 'older-row', '2022-01-01T00:00:00.000Z')}
`);

    try {
      const defaults = await getDefaultsByArrType(fixture.cache, arrType);
      assertExists(defaults);
      assertEquals(defaults.name, 'older-row');
    } finally {
      await fixture.destroy();
    }
  });

  Deno.test(`${arrType} defaults return null for empty table`, async () => {
    const fixture = createCacheFixture();

    try {
      const defaults = await getDefaultsByArrType(fixture.cache, arrType);
      assertEquals(defaults, null);
    } finally {
      await fixture.destroy();
    }
  });

  Deno.test(`${arrType} defaults use name tie-breaker when created_at is equal`, async () => {
    const fixture = createCacheFixture(`
${insertNamingRow(arrType, 'zzz-name', '2024-01-01T00:00:00.000Z')}
${insertNamingRow(arrType, 'aaa-name', '2024-01-01T00:00:00.000Z')}
`);

    try {
      const defaults = await getDefaultsByArrType(fixture.cache, arrType);
      assertExists(defaults);
      assertEquals(defaults.name, 'aaa-name');
    } finally {
      await fixture.destroy();
    }
  });
}
