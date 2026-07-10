// Schema-default parser tests (issue #231). Covers literal ints/strings, CURRENT_TIMESTAMP
// (non-comparable), `DEFAULT <lit> CHECK (...)` truncation, per-table column divergence, CHECK
// IN-lists on the next physical line, NOT NULL detection, and no-default columns.

import { assertEquals } from '@std/assert';
import { parseSchemaDefaults, clearSchemaDefaultsCache, lookupSchemaDefault } from '$pcd/resolved/lineage/schemaDefaults.ts';

const DDL = `
CREATE TABLE custom_formats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    include_in_rename INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quality_profiles (
    name VARCHAR(100) NOT NULL,
    upgrade_score_increment INTEGER NOT NULL DEFAULT 1 CHECK (upgrade_score_increment > 0)
);

CREATE TABLE radarr_naming (
    name VARCHAR(100) NOT NULL PRIMARY KEY,
    colon_replacement_format VARCHAR(20) NOT NULL DEFAULT 'smart'
        CHECK (colon_replacement_format IN ('delete', 'dash', 'smart'))
);

CREATE TABLE sonarr_naming (
    name VARCHAR(100) NOT NULL PRIMARY KEY,
    colon_replacement_format INTEGER NOT NULL DEFAULT 4
);

CREATE TABLE lidarr_media_settings (
    name VARCHAR(100) NOT NULL PRIMARY KEY,
    propers_repacks VARCHAR(50) NOT NULL DEFAULT 'doNotPrefer'
        CHECK (propers_repacks IN ('doNotPrefer', 'preferAndUpgrade', 'doNotUpgradeAutomatically')),
    min_bytes INTEGER
);
`;

async function withSchema<T>(fn: (pcdPath: string) => Promise<T>): Promise<T> {
  clearSchemaDefaultsCache();
  const pcdPath = await Deno.makeTempDir({ prefix: 'schema-defaults-' });
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.writeTextFile(`${pcdPath}/deps/schema/ops/0.schema.sql`, DDL);
  try {
    return await fn(pcdPath);
  } finally {
    await Deno.remove(pcdPath, { recursive: true });
  }
}

Deno.test('schemaDefaults: parses literal, CURRENT_TIMESTAMP, CHECK-truncated, and no-default columns', async () => {
  await withSchema(async (pcdPath) => {
    const map = await parseSchemaDefaults(pcdPath);

    const includeInRename = lookupSchemaDefault(map, 'custom_formats', 'include_in_rename');
    assertEquals(includeInRename, { hasDefault: true, defaultLiteral: '0', notNull: true, schemaFile: '0.schema.sql' });

    const description = lookupSchemaDefault(map, 'custom_formats', 'description');
    assertEquals(description?.hasDefault, false);

    const createdAt = lookupSchemaDefault(map, 'custom_formats', 'created_at');
    assertEquals(createdAt?.hasDefault, true);
    assertEquals(createdAt?.defaultLiteral, null, 'CURRENT_TIMESTAMP is a non-comparable default');

    const increment = lookupSchemaDefault(map, 'quality_profiles', 'upgrade_score_increment');
    assertEquals(increment?.defaultLiteral, '1', 'literal is 1, not the CHECK expression');
  });
});

Deno.test('schemaDefaults: same column name diverges per table (radarr string vs sonarr int)', async () => {
  await withSchema(async (pcdPath) => {
    const map = await parseSchemaDefaults(pcdPath);
    assertEquals(lookupSchemaDefault(map, 'radarr_naming', 'colon_replacement_format')?.defaultLiteral, 'smart');
    assertEquals(lookupSchemaDefault(map, 'sonarr_naming', 'colon_replacement_format')?.defaultLiteral, '4');
  });
});

Deno.test('schemaDefaults: CHECK IN-list on the next line is not slurped into the default', async () => {
  await withSchema(async (pcdPath) => {
    const map = await parseSchemaDefaults(pcdPath);
    assertEquals(lookupSchemaDefault(map, 'lidarr_media_settings', 'propers_repacks')?.defaultLiteral, 'doNotPrefer');
    assertEquals(lookupSchemaDefault(map, 'lidarr_media_settings', 'min_bytes')?.hasDefault, false);
  });
});
