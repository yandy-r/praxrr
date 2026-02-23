import { assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/database/cache.ts';
import { convertCompiledCacheToEntities } from '$pcd/migration/converter.ts';
import { readMigrationEntitySources } from '$pcd/migration/reader.ts';
import { entityNameToSlug } from '$pcd/migration/slug.ts';

type SqlParam = string | number | null | boolean | Uint8Array;

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

const REGULAR_EXPRESSION_NAMES = ['Zebra Regex', 'Alpha Regex'];
const DELAY_PROFILE_NAMES = ['Beta Delay', 'Alpha Delay'];

function buildCacheFixture(): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

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

CREATE TABLE IF NOT EXISTS regular_expressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  description TEXT,
  regex101_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  name TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS regular_expression_tags (
  regular_expression_name TEXT NOT NULL,
  tag_name TEXT NOT NULL
);
`);

  db.exec("INSERT INTO delay_profiles (name, preferred_protocol, usenet_delay, torrent_delay, bypass_if_highest_quality, bypass_if_above_custom_format_score, minimum_custom_format_score) VALUES ('Beta Delay', 'prefer_usenet', 120, 240, 1, 0, 900)");
  db.exec("INSERT INTO delay_profiles (name, preferred_protocol, usenet_delay, torrent_delay, bypass_if_highest_quality, bypass_if_above_custom_format_score, minimum_custom_format_score) VALUES ('Alpha Delay', 'only_torrent', 60, 30, 0, 1, 700)");
  db.exec("INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES ('Zebra Regex', 'Zebra.*', 'Supports Z order', 'R1')");
  db.exec("INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES ('Alpha Regex', 'Alpha.*', 'Supports A order', 'R2')");
  db.exec("INSERT INTO tags (name) VALUES ('core')");
  db.exec("INSERT INTO regular_expression_tags (regular_expression_name, tag_name) VALUES ('Alpha Regex', 'core')");

  const query = ((sql: string, ...params: SqlParam[]): unknown[] => {
    return db.prepare(sql).all(...params) as unknown[];
  }) as PCDCache['query'];

  const queryOne = ((sql: string, ...params: SqlParam[]): unknown | undefined => {
    return db.prepare(sql).get(...params) as unknown | undefined;
  }) as PCDCache['queryOne'];

  const fixture: PCDCache = {
    isBuilt: () => true,
    kb,
    query,
    queryOne,
  } as PCDCache;

  return {
    cache: fixture,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function expectedEntityPaths(): string[] {
  const regularExpressions = REGULAR_EXPRESSION_NAMES.slice().sort();
  const delayProfiles = DELAY_PROFILE_NAMES.slice().sort();

  return [
    ...regularExpressions.map((name) => `regular-expressions/${entityNameToSlug(name)}.yaml`),
    ...delayProfiles.map((name) => `delay-profiles/${entityNameToSlug(name)}.yaml`),
  ].sort();
}

async function listFilesRecursively(rootDir: string, relativePath = ''): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of Deno.readDir(relativePath ? `${rootDir}/${relativePath}` : rootDir)) {
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      const nested = await listFilesRecursively(rootDir, entryPath);
      files.push(...nested);
      continue;
    }

    if (!entry.isFile) continue;
    files.push(entryPath);
  }

  return files;
}

async function readOutputSnapshot(outputDir: string): Promise<Array<[string, string]>> {
  const files = await listFilesRecursively(outputDir);
  const sortedFiles = files.sort();
  const rows: Array<[string, string]> = [];

  for (const file of sortedFiles) {
    rows.push([file, await Deno.readTextFile(`${outputDir}/${file}`)]);
  }

  return rows;
}

async function withTempOutputDir(
  test: (outputDir: string) => Promise<void>
): Promise<void> {
  const outputDir = await Deno.makeTempDir({ prefix: 'praxrr-migration-converter-' });

  try {
    await test(outputDir);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
}

Deno.test('converter writes entities in deterministic order with valid paths and reader-compatible payloads', async () => {
  const fixture = buildCacheFixture();

  try {
    await withTempOutputDir(async (outputDir) => {
      const outputRoot = `${outputDir}/conversion`;
      const report = await convertCompiledCacheToEntities({
        cache: fixture.cache,
        outputDir: `${outputRoot}/entities`,
        format: 'yaml',
        overwrite: true,
        entityTypes: ['regular_expression', 'delay_profile'],
        includeMigrationMetadata: true,
      });

      assertEquals(report.totalFiles, 4);
      assertEquals(report.writtenFiles, 4);
      assertEquals(report.failedFiles, 0);
      assertEquals(report.entitySummaries.length, 2);

      const summariesByType = Object.fromEntries(
        report.entitySummaries.map((summary) => [summary.entityType, summary]),
      ) as Record<string, { entityType: string; relativeDir: string; total: number; written: number }>;

      assertEquals(summariesByType.delay_profile.total, 2);
      assertEquals(summariesByType.delay_profile.written, 2);
      assertEquals(summariesByType.delay_profile.relativeDir, 'delay-profiles');
      assertEquals(summariesByType.regular_expression.total, 2);
      assertEquals(summariesByType.regular_expression.written, 2);
      assertEquals(summariesByType.regular_expression.relativeDir, 'regular-expressions');

      const readResult = await readMigrationEntitySources(outputRoot);
      assertEquals(readResult.issues, []);

      const paths = readResult.candidates
        .map((candidate) => candidate.relativePath)
        .sort();
      assertEquals(paths, expectedEntityPaths());

      const topLevelPaths = readResult.candidates.map((candidate) => candidate.relativePath.split('/')[0]);
      assertEquals(topLevelPaths.sort(), ['delay-profiles', 'delay-profiles', 'regular-expressions', 'regular-expressions'].sort());

      const totalRegularExpressions = readResult.candidates.filter((candidate) => candidate.entityType === 'regular_expression').length;
      const totalDelayProfiles = readResult.candidates.filter((candidate) => candidate.entityType === 'delay_profile').length;
      assertEquals(totalRegularExpressions, 2);
      assertEquals(totalDelayProfiles, 2);
    });
  } finally {
    await fixture.destroy();
  }
});

Deno.test('converter output is byte-identical across repeated conversions from same cache source', async () => {
  const fixture = buildCacheFixture();

  try {
    await withTempOutputDir(async (outputDir) => {
      const outputRoot = `${outputDir}/conversion`;
      const outputPath = `${outputRoot}/entities`;

      const firstRun = await convertCompiledCacheToEntities({
        cache: fixture.cache,
        outputDir: outputPath,
        format: 'yaml',
        overwrite: true,
        entityTypes: ['regular_expression', 'delay_profile'],
        includeMigrationMetadata: true,
      });

      const firstSnapshot = await readOutputSnapshot(outputPath);
      assertEquals(firstRun.writtenFiles, firstSnapshot.length);

      const secondRun = await convertCompiledCacheToEntities({
        cache: fixture.cache,
        outputDir: outputPath,
        format: 'yaml',
        overwrite: true,
        entityTypes: ['regular_expression', 'delay_profile'],
        includeMigrationMetadata: true,
      });

      const secondSnapshot = await readOutputSnapshot(outputPath);
      assertEquals(secondRun.writtenFiles, secondSnapshot.length);
      assertEquals(firstSnapshot, secondSnapshot);
    });
  } finally {
    await fixture.destroy();
  }
});
