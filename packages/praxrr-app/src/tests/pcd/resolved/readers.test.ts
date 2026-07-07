import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import {
  isReaderNotFoundMessage,
  isResolvedConfigValidationError,
  isResolvedEntityNotFoundError,
  listResolvedEntityNames,
  readResolvedEntity,
  ResolvedConfigValidationError,
  ResolvedEntityNotFoundError,
} from '$pcd/resolved/readers.ts';

// Mirrors parityMapApi.test.ts's fixture recipe: an in-memory PCDCache built from
// hand-written CREATE TABLE/INSERT statements covering only the tables the readers
// under test touch. `isBuilt: () => true` is not needed here since readers.ts never
// calls it -- only `cache.kb` is exercised.
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

const SCHEMA_AND_DATA_SQL = `
CREATE TABLE regular_expressions (
  name TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  description TEXT,
  regex101_id TEXT
);

CREATE TABLE tags (
  name TEXT PRIMARY KEY
);

CREATE TABLE regular_expression_tags (
  regular_expression_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  PRIMARY KEY (regular_expression_name, tag_name)
);

CREATE TABLE radarr_naming (
  name TEXT PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 1,
  movie_format TEXT NOT NULL,
  movie_folder_format TEXT NOT NULL,
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format TEXT NOT NULL DEFAULT 'delete',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*sample.*', 'A sample regular expression', NULL);

INSERT INTO radarr_naming (name, movie_format, movie_folder_format) VALUES
  ('Default', '{Movie Title} ({Release Year})', '{Movie Title} ({Release Year})');
`;

function withFixture(fn: (cache: PCDCache) => Promise<void>): Promise<void> {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  return fn(fixture.cache).finally(fixture.destroy);
}

Deno.test('readResolvedEntity dispatches an arr-agnostic entity type without an arrType', async () => {
  await withFixture(async (cache) => {
    const result = await readResolvedEntity(cache, 'regularExpression', undefined, 'Sample RE');
    assertEquals((result as { name: string }).name, 'Sample RE');
  });
});

Deno.test('readResolvedEntity dispatches a per-arr entity type to the matching arrType reader', async () => {
  await withFixture(async (cache) => {
    const result = await readResolvedEntity(cache, 'naming', 'radarr', 'Default');
    assertEquals((result as { name: string }).name, 'Default');
  });
});

Deno.test('readResolvedEntity fails fast on lidarrMetadataProfile + radarr with no sibling fallback', async () => {
  await withFixture(async (cache) => {
    await assertRejects(
      () => readResolvedEntity(cache, 'lidarrMetadataProfile', 'radarr', 'Standard'),
      ResolvedConfigValidationError
    );

    try {
      await readResolvedEntity(cache, 'lidarrMetadataProfile', 'radarr', 'Standard');
      assert(false, 'expected readResolvedEntity to throw');
    } catch (error) {
      assert(isResolvedConfigValidationError(error));
    }
  });
});

Deno.test('readResolvedEntity fails fast when arrType is missing for a per-arr entity type', async () => {
  await withFixture(async (cache) => {
    await assertRejects(() => readResolvedEntity(cache, 'naming', undefined, 'Default'), ResolvedConfigValidationError);
  });
});

Deno.test('readResolvedEntity rejects an arrType supplied for an arr-agnostic entity type', async () => {
  await withFixture(async (cache) => {
    await assertRejects(
      () => readResolvedEntity(cache, 'regularExpression', 'radarr', 'Sample RE'),
      ResolvedConfigValidationError
    );
  });
});

Deno.test('readResolvedEntity rewraps a by-name miss from serialize.ts as ResolvedEntityNotFoundError', async () => {
  await withFixture(async (cache) => {
    try {
      await readResolvedEntity(cache, 'regularExpression', undefined, 'Does Not Exist');
      assert(false, 'expected readResolvedEntity to throw');
    } catch (error) {
      assert(error instanceof Error);
      assert(isResolvedEntityNotFoundError(error));
      assert(!isResolvedConfigValidationError(error));
      assert(String((error as Error).message).includes('not found'));
    }
  });
});

Deno.test(
  'readResolvedEntity: the rewrapped not-found error is an instance of ResolvedEntityNotFoundError',
  async () => {
    await withFixture(async (cache) => {
      await assertRejects(
        () => readResolvedEntity(cache, 'regularExpression', undefined, 'Does Not Exist'),
        ResolvedEntityNotFoundError
      );
    });
  }
);

// ============================================================================
// isReaderNotFoundMessage -- exact-shape gate distinguishing a by-name miss from a
// genuine cache/data-integrity failure (CONFIRMED string-sniffing hazard fix).
// ============================================================================

Deno.test('isReaderNotFoundMessage matches the exact serialize.ts by-name-miss shape', () => {
  assertEquals(isReaderNotFoundMessage('Regular expression "Sample RE" not found', 'Sample RE'), true);
  assertEquals(isReaderNotFoundMessage('Lidarr metadata profile "Standard" not found', 'Standard'), true);
});

Deno.test('isReaderNotFoundMessage does not match PCDCache SQL-helper-shaped errors', () => {
  // database/cache.ts::registerHelperFunctions throws "<Label> not found: <name>" (no
  // quotes, "not found" mid-sentence) -- a genuine cache/data-integrity failure, not a
  // by-name miss on this read, and must never be reclassified as one.
  assertEquals(isReaderNotFoundMessage('Tag not found: Sample RE', 'Sample RE'), false);
  assertEquals(isReaderNotFoundMessage('Quality profile not found: Sample RE', 'Sample RE'), false);
});

Deno.test('isReaderNotFoundMessage does not match ResolvedConfigDatabaseNotFoundError-shaped messages', () => {
  assertEquals(isReaderNotFoundMessage('Database instance 42 not found', 'Sample RE'), false);
});

Deno.test('isReaderNotFoundMessage does not match when the message is for a different name', () => {
  assertEquals(isReaderNotFoundMessage('Regular expression "Other Name" not found', 'Sample RE'), false);
});

Deno.test('listResolvedEntityNames lists names for an arr-agnostic entity type', async () => {
  await withFixture(async (cache) => {
    const names = await listResolvedEntityNames(cache, 'regularExpression');
    assertEquals(names, ['Sample RE']);
  });
});

Deno.test('listResolvedEntityNames lists names for a per-arr entity type', async () => {
  await withFixture(async (cache) => {
    const names = await listResolvedEntityNames(cache, 'naming', 'radarr');
    assertEquals(names, ['Default']);
  });
});

Deno.test('listResolvedEntityNames fails fast when arrType is missing for a per-arr entity type', async () => {
  await withFixture(async (cache) => {
    await assertRejects(() => listResolvedEntityNames(cache, 'naming'), ResolvedConfigValidationError);
  });
});
