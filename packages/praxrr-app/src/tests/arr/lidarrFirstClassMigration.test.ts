import { assertEquals, assertExists } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { LIDARR_MEDIA_MANAGEMENT_OP_SQL } from '$db/migrations/20260215_add_lidarr_media_management_entities.ts';

interface MigrationFixture {
  db: Database;
  kb: Kysely<PCDDatabase>;
  destroy: () => Promise<void>;
}

function preMigrationSchema(extraInserts = ''): string {
  return `
CREATE TABLE IF NOT EXISTS qualities (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name VARCHAR(100) UNIQUE NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sonarr_naming (
	name TEXT NOT NULL PRIMARY KEY,
	rename INTEGER NOT NULL DEFAULT 0,
	standard_episode_format TEXT NOT NULL DEFAULT '',
	daily_episode_format TEXT NOT NULL DEFAULT '',
	anime_episode_format TEXT NOT NULL DEFAULT '',
	series_folder_format TEXT NOT NULL DEFAULT '',
	season_folder_format TEXT NOT NULL DEFAULT '',
	replace_illegal_characters INTEGER NOT NULL DEFAULT 0,
	colon_replacement_format INTEGER NOT NULL DEFAULT 4,
	custom_colon_replacement_format TEXT,
	multi_episode_style INTEGER NOT NULL DEFAULT 5,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sonarr_media_settings (
	name TEXT NOT NULL PRIMARY KEY,
	propers_repacks TEXT NOT NULL,
	enable_media_info INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_api_mappings (
	quality_name TEXT NOT NULL,
	arr_type TEXT NOT NULL,
	api_name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE IF NOT EXISTS sonarr_quality_definitions (
	name TEXT NOT NULL,
	quality_name TEXT NOT NULL,
	min_size INTEGER NOT NULL,
	max_size INTEGER NOT NULL,
	preferred_size INTEGER NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (name, quality_name)
);

${extraInserts}
`;
}

function createMigrationFixture(preMigrationSql: string): MigrationFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(preMigrationSql);

  return {
    db,
    kb,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function runMigration(db: Database): void {
  db.exec(LIDARR_MEDIA_MANAGEMENT_OP_SQL);
}

Deno.test('migration creates lidarr_naming, lidarr_media_settings, lidarr_quality_definitions tables', async () => {
  const fixture = createMigrationFixture(
    preMigrationSchema(`
INSERT INTO sonarr_naming
	(name, rename, standard_episode_format, daily_episode_format, anime_episode_format,
	 series_folder_format, season_folder_format, replace_illegal_characters, colon_replacement_format)
VALUES ('Seed-Naming', 1, 'S{season:00}E{episode}', '{Series}', '{Anime}', 'Series', 'Season {season}', 1, 4);

INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Seed-Media', 'preferAndUpgrade', 1);

INSERT INTO qualities (name) VALUES ('FLAC');

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('FLAC', 'sonarr', 'FLAC');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Seed-QD', 'FLAC', 64, 1024, 320);
`)
  );

  try {
    runMigration(fixture.db);

    // Verify lidarr_naming was populated from sonarr_naming
    const namingRows = await fixture.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .select(['name', 'standard_track_format', 'artist_name'])
      .execute();
    assertEquals(namingRows.length, 1);
    assertEquals(namingRows[0].name, 'Seed-Naming');
    assertEquals(namingRows[0].standard_track_format, 'S{season:00}E{episode}');
    assertEquals(namingRows[0].artist_name, '{Series}');

    // Verify lidarr_media_settings was populated from sonarr_media_settings
    const mediaRows = await fixture.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .select(['name', 'propers_repacks', 'enable_media_info'])
      .execute();
    assertEquals(mediaRows.length, 1);
    assertEquals(mediaRows[0].name, 'Seed-Media');
    assertEquals(mediaRows[0].propers_repacks, 'preferAndUpgrade');
    assertEquals(mediaRows[0].enable_media_info, 1);

    // Verify lidarr_quality_definitions was populated from sonarr_quality_definitions
    const qdRows = await fixture.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .select(['name', 'quality_name', 'min_size', 'max_size', 'preferred_size'])
      .execute();
    assertEquals(qdRows.length, 1);
    assertEquals(qdRows[0].name, 'Seed-QD');
    assertEquals(qdRows[0].quality_name, 'FLAC');
    assertEquals(qdRows[0].min_size, 64);

    // Verify quality_api_mappings seeded lidarr from sonarr
    const mappingRows = await fixture.kb
      .selectFrom('quality_api_mappings')
      .select(['quality_name', 'arr_type', 'api_name'])
      .where('arr_type', '=', 'lidarr')
      .execute();
    assertEquals(mappingRows.length, 1);
    assertEquals(mappingRows[0].quality_name, 'FLAC');
    assertEquals(mappingRows[0].api_name, 'FLAC');
  } finally {
    await fixture.destroy();
  }
});

Deno.test('migration is idempotent: running twice produces same results', async () => {
  const fixture = createMigrationFixture(
    preMigrationSchema(`
INSERT INTO sonarr_naming
	(name, rename, standard_episode_format, daily_episode_format, anime_episode_format,
	 series_folder_format, season_folder_format, replace_illegal_characters, colon_replacement_format)
VALUES ('Idempotent-Naming', 1, 'Ep{episode}', '{Daily}', '{Anime}', 'Series', 'Season', 0, 4);

INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Idempotent-Media', 'doNotPrefer', 0);

INSERT INTO qualities (name) VALUES ('Unknown');

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('Unknown', 'sonarr', 'Unknown');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Idempotent-QD', 'Unknown', 8, 80, 20);
`)
  );

  try {
    // Run migration first time
    runMigration(fixture.db);

    const namingAfterFirst = await fixture.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .selectAll()
      .execute();
    const mediaAfterFirst = await fixture.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .selectAll()
      .execute();
    const qdAfterFirst = await fixture.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .selectAll()
      .execute();
    const mappingsAfterFirst = await fixture.kb
      .selectFrom('quality_api_mappings')
      .selectAll()
      .where('arr_type', '=', 'lidarr')
      .execute();

    // Run migration second time
    runMigration(fixture.db);

    const namingAfterSecond = await fixture.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .selectAll()
      .execute();
    const mediaAfterSecond = await fixture.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .selectAll()
      .execute();
    const qdAfterSecond = await fixture.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .selectAll()
      .execute();
    const mappingsAfterSecond = await fixture.kb
      .selectFrom('quality_api_mappings')
      .selectAll()
      .where('arr_type', '=', 'lidarr')
      .execute();

    // Row counts must be identical after rerun
    assertEquals(namingAfterFirst.length, namingAfterSecond.length);
    assertEquals(mediaAfterFirst.length, mediaAfterSecond.length);
    assertEquals(qdAfterFirst.length, qdAfterSecond.length);
    assertEquals(mappingsAfterFirst.length, mappingsAfterSecond.length);

    // Field values must be identical after rerun
    assertEquals(namingAfterFirst[0].name, namingAfterSecond[0].name);
    assertEquals(mediaAfterFirst[0].name, mediaAfterSecond[0].name);
    assertEquals(qdAfterFirst[0].name, qdAfterSecond[0].name);
    assertEquals(mappingsAfterFirst[0].api_name, mappingsAfterSecond[0].api_name);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('migration conflict handling: existing lidarr rows are preserved on conflict', async () => {
  const fixture = createMigrationFixture(
    preMigrationSchema(`
INSERT INTO sonarr_naming
	(name, rename, standard_episode_format, daily_episode_format, anime_episode_format,
	 series_folder_format, season_folder_format, replace_illegal_characters, colon_replacement_format)
VALUES ('Conflict-Name', 0, 'Sonarr-Ep', 'Sonarr-Daily', 'Sonarr-Anime', 'Sonarr-Series', 'Sonarr-Season', 0, 4);

INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Conflict-Media', 'doNotPrefer', 0);

INSERT INTO qualities (name) VALUES ('FLAC');

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('FLAC', 'sonarr', 'FLAC');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Conflict-QD', 'FLAC', 10, 100, 50);
`)
  );

  try {
    // Run migration first to create lidarr tables and copy data
    runMigration(fixture.db);

    // Manually update lidarr rows to simulate operator customization
    fixture.db.exec(`
			UPDATE lidarr_naming SET standard_track_format = 'Customized-Track' WHERE name = 'Conflict-Name';
			UPDATE lidarr_media_settings SET propers_repacks = 'preferAndUpgrade' WHERE name = 'Conflict-Media';
			UPDATE lidarr_quality_definitions SET min_size = 999 WHERE name = 'Conflict-QD' AND quality_name = 'FLAC';
		`);

    // Run migration again: existing lidarr rows must be preserved
    runMigration(fixture.db);

    const namingRow = await fixture.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .select(['name', 'standard_track_format'])
      .where('name', '=', 'Conflict-Name')
      .executeTakeFirst();
    assertExists(namingRow);
    assertEquals(namingRow.standard_track_format, 'Customized-Track');

    const mediaRow = await fixture.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .select(['name', 'propers_repacks'])
      .where('name', '=', 'Conflict-Media')
      .executeTakeFirst();
    assertExists(mediaRow);
    assertEquals(mediaRow.propers_repacks, 'preferAndUpgrade');

    const qdRow = await fixture.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .select(['name', 'quality_name', 'min_size'])
      .where('name', '=', 'Conflict-QD')
      .executeTakeFirst();
    assertExists(qdRow);
    assertEquals(qdRow.min_size, 999);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('after migration lidarr entities are stored in dedicated tables not sonarr tables', async () => {
  const fixture = createMigrationFixture(
    preMigrationSchema(`
INSERT INTO sonarr_naming
	(name, rename, standard_episode_format, daily_episode_format, anime_episode_format,
	 series_folder_format, season_folder_format, replace_illegal_characters, colon_replacement_format)
VALUES ('Dedicated-Naming', 1, 'S{e}', '{D}', '{A}', 'SF', 'SeF', 1, 4);

INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Dedicated-Media', 'preferAndUpgrade', 1);

INSERT INTO qualities (name) VALUES ('AAC-192');

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES ('AAC-192', 'sonarr', 'AAC-192');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Dedicated-QD', 'AAC-192', 32, 800, 200);
`)
  );

  try {
    runMigration(fixture.db);

    // Lidarr rows exist in lidarr tables
    const lidarrNaming = await fixture.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .select(['name'])
      .where('name', '=', 'Dedicated-Naming')
      .executeTakeFirst();
    assertExists(lidarrNaming);

    const lidarrMedia = await fixture.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .select(['name'])
      .where('name', '=', 'Dedicated-Media')
      .executeTakeFirst();
    assertExists(lidarrMedia);

    const lidarrQd = await fixture.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .select(['name'])
      .where('name', '=', 'Dedicated-QD')
      .executeTakeFirst();
    assertExists(lidarrQd);

    // Sonarr source rows still exist (migration copies, does not move)
    const sonarrNaming = await fixture.kb
      .selectFrom('sonarr_naming')
      .select(['name'])
      .where('name', '=', 'Dedicated-Naming')
      .executeTakeFirst();
    assertExists(sonarrNaming);

    // Lidarr quality_api_mappings rows exist independently
    const lidarrMapping = await fixture.kb
      .selectFrom('quality_api_mappings')
      .select(['quality_name', 'api_name'])
      .where('arr_type', '=', 'lidarr')
      .execute();
    assertEquals(lidarrMapping.length, 1);
    assertEquals(lidarrMapping[0].quality_name, 'AAC-192');
  } finally {
    await fixture.destroy();
  }
});

Deno.test('migration with no sonarr source rows produces empty lidarr tables', async () => {
  const fixture = createMigrationFixture(preMigrationSchema());

  try {
    runMigration(fixture.db);

    const namingRows = await fixture.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .selectAll()
      .execute();
    assertEquals(namingRows.length, 0);

    const mediaRows = await fixture.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .selectAll()
      .execute();
    assertEquals(mediaRows.length, 0);

    const qdRows = await fixture.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .selectAll()
      .execute();
    assertEquals(qdRows.length, 0);

    const mappings = await fixture.kb
      .selectFrom('quality_api_mappings')
      .selectAll()
      .where('arr_type', '=', 'lidarr')
      .execute();
    assertEquals(mappings.length, 0);
  } finally {
    await fixture.destroy();
  }
});

Deno.test('migration quality_api_mappings updates divergent lidarr api_name from sonarr', async () => {
  const fixture = createMigrationFixture(
    preMigrationSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
	('FLAC', 'sonarr', 'FLAC-Updated'),
	('FLAC', 'lidarr', 'FLAC-Old');
`)
  );

  try {
    runMigration(fixture.db);

    const lidarrMapping = await fixture.kb
      .selectFrom('quality_api_mappings')
      .select(['api_name'])
      .where('quality_name', '=', 'FLAC')
      .where('arr_type', '=', 'lidarr')
      .executeTakeFirst();

    assertExists(lidarrMapping);
    assertEquals(lidarrMapping.api_name, 'FLAC-Updated');
  } finally {
    await fixture.destroy();
  }
});

Deno.test('migration quality_api_mappings preserves identical lidarr api_name', async () => {
  const fixture = createMigrationFixture(
    preMigrationSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
	('AAC-192', 'sonarr', 'AAC-192'),
	('AAC-192', 'lidarr', 'AAC-192');
`)
  );

  try {
    runMigration(fixture.db);

    const lidarrMapping = await fixture.kb
      .selectFrom('quality_api_mappings')
      .select(['api_name'])
      .where('quality_name', '=', 'AAC-192')
      .where('arr_type', '=', 'lidarr')
      .executeTakeFirst();

    assertExists(lidarrMapping);
    assertEquals(lidarrMapping.api_name, 'AAC-192');
  } finally {
    await fixture.destroy();
  }
});

Deno.test('migration copies multiple sonarr rows and preserves all per-table', async () => {
  const fixture = createMigrationFixture(
    preMigrationSchema(`
INSERT INTO sonarr_naming
	(name, rename, standard_episode_format, daily_episode_format, anime_episode_format,
	 series_folder_format, season_folder_format, replace_illegal_characters, colon_replacement_format)
VALUES
	('Naming-A', 1, 'EpA', 'DayA', 'AniA', 'SFA', 'SeFA', 1, 4),
	('Naming-B', 0, 'EpB', 'DayB', 'AniB', 'SFB', 'SeFB', 0, 4);

INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES
	('Media-A', 'doNotPrefer', 0),
	('Media-B', 'preferAndUpgrade', 1);

INSERT INTO qualities (name) VALUES ('FLAC'), ('Unknown');

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
	('FLAC', 'sonarr', 'FLAC'),
	('Unknown', 'sonarr', 'Unknown');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES
	('QD-A', 'FLAC', 64, 1024, 320),
	('QD-A', 'Unknown', 8, 80, 20),
	('QD-B', 'FLAC', 128, 2048, 640);
`)
  );

  try {
    runMigration(fixture.db);

    const namingRows = await fixture.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .select(['name'])
      .orderBy('name', 'asc')
      .execute();
    assertEquals(namingRows.length, 2);
    assertEquals(namingRows[0].name, 'Naming-A');
    assertEquals(namingRows[1].name, 'Naming-B');

    const mediaRows = await fixture.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .select(['name'])
      .orderBy('name', 'asc')
      .execute();
    assertEquals(mediaRows.length, 2);
    assertEquals(mediaRows[0].name, 'Media-A');
    assertEquals(mediaRows[1].name, 'Media-B');

    const qdRows = await fixture.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .select(['name', 'quality_name'])
      .orderBy('name', 'asc')
      .orderBy('quality_name', 'asc')
      .execute();
    assertEquals(qdRows.length, 3);
    assertEquals(qdRows[0].name, 'QD-A');
    assertEquals(qdRows[0].quality_name, 'FLAC');
    assertEquals(qdRows[1].name, 'QD-A');
    assertEquals(qdRows[1].quality_name, 'Unknown');
    assertEquals(qdRows[2].name, 'QD-B');
    assertEquals(qdRows[2].quality_name, 'FLAC');

    const mappings = await fixture.kb
      .selectFrom('quality_api_mappings')
      .select(['quality_name'])
      .where('arr_type', '=', 'lidarr')
      .orderBy('quality_name', 'asc')
      .execute();
    assertEquals(mappings.length, 2);
    assertEquals(mappings[0].quality_name, 'FLAC');
    assertEquals(mappings[1].quality_name, 'Unknown');
  } finally {
    await fixture.destroy();
  }
});
