import { assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { RequestEvent } from '@sveltejs/kit';
import { deleteCache, setCache } from '$pcd/database/registry.ts';
import { GET as exportGet } from '../../routes/api/v1/pcd/export/+server.ts';
import { PORTABLE_MIGRATION_MIN_VERSION, PORTABLE_MIGRATION_SOURCE_EXPORT } from '$shared/pcd/portable.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

const DATABASE_ID = 9321;

Deno.test('pcd export: includes migration source and schema metadata', async () => {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  try {
    db.exec(`
CREATE TABLE IF NOT EXISTS delay_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  preferred_protocol TEXT NOT NULL,
  usenet_delay INTEGER,
  torrent_delay INTEGER,
  bypass_if_highest_quality INTEGER NOT NULL DEFAULT 0,
  bypass_if_above_custom_format_score INTEGER NOT NULL DEFAULT 0,
  minimum_custom_format_score INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
    db.exec(
      "INSERT INTO delay_profiles (name, preferred_protocol, usenet_delay, torrent_delay) VALUES ('Export-Delay', 'both', 120, 240)"
    );

    const cache = { kb, getRawDb: () => db } as PCDCache;
    setCache(DATABASE_ID, cache);

    const response = await exportGet({
      url: new URL(
        `http://localhost/api/v1/pcd/export?databaseId=${DATABASE_ID}&entityType=delay_profile&name=Export-Delay`
      ),
      request: new Request(
        `http://localhost/api/v1/pcd/export?databaseId=${DATABASE_ID}&entityType=delay_profile&name=Export-Delay`
      ),
    } as unknown as RequestEvent);
    const body = (await response.json()) as {
      migration: {
        source: string;
        format: string;
        version: number;
      };
      entityType: string;
      data: { name: string };
    };

    assertEquals(response.status, 200);

    assertEquals(body.entityType, 'delay_profile');
    assertEquals(body.data.name, 'Export-Delay');
    assertEquals(body.migration.source, PORTABLE_MIGRATION_SOURCE_EXPORT);
    assertEquals(body.migration.format, 'json');
    assertEquals(body.migration.version, PORTABLE_MIGRATION_MIN_VERSION);
  } finally {
    await kb.destroy();
    db.close();
    deleteCache(DATABASE_ID);
  }
});
