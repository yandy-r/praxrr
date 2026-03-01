import { assertEquals, assertInstanceOf, assertThrows } from '@std/assert';
import { DatabaseNotInitializedError } from '../../lib/server/db/db.ts';
import {
  buildSourceContext,
  listTrashSourcesSafely,
  resolveDatabases,
  sourceKey,
  isTrashSource,
  sortRowsByNameAndSource,
  withPcdSource,
} from '../../lib/server/utils/sourceContext.ts';

interface FakeDatabase {
  id: number;
  name: string;
}

interface FakeSource {
  id: number;
  arrType: 'radarr' | 'sonarr';
  name: string;
  entityCounts: {
    customFormats: number;
    qualityProfiles: number;
  };
}

function throwNotInitialized(): never {
  throw new DatabaseNotInitializedError();
}

Deno.test('source context builds default key and source metadata for mixed sources', () => {
  const databases: FakeDatabase[] = [{ id: 1, name: 'Praxrr-DB' }];

  const context = buildSourceContext(
    databases,
    databases[0],
    [{ id: 10, arrType: 'radarr', name: 'TRaSH Radarr', entityCounts: { customFormats: 2, qualityProfiles: 0 } }],
    (source) => source.entityCounts.customFormats,
    (source) => source.name,
    'custom formats'
  );

  assertEquals(context.defaultSourceKey, sourceKey({ type: 'pcd', id: 1 }));
  assertEquals(context.showAllSourcesTab, true);
  assertEquals(context.filterDisabledReason, null);
  assertEquals(context.availableSources, [
    { type: 'pcd', id: 1, name: 'Praxrr-DB' },
    { type: 'trash', id: 10, name: 'TRaSH Radarr', arrType: 'radarr' },
  ]);
  assertEquals(context.availableSources.every(isTrashSource), false);
});

Deno.test('source context reports mismatch when TRaSH sources lack requested entities', () => {
  const databases: FakeDatabase[] = [{ id: 7, name: 'Primary' }];
  const context = buildSourceContext(
    databases,
    databases[0],
    [{ id: 11, arrType: 'sonarr', name: 'TRaSH Sonarr', entityCounts: { customFormats: 0, qualityProfiles: 4 } }],
    (source) => source.entityCounts.customFormats,
    (source) => source.name,
    'custom formats'
  );

  assertEquals(context.availableSources, [{ type: 'pcd', id: 7, name: 'Primary' }]);
  assertEquals(context.filterDisabledReason, 'Linked TRaSH sources do not currently provide custom formats');
});

Deno.test('withPcdSource annotates rows', () => {
  const rows = [{ name: 'first', id: 4, sourceDatabaseName: 'old' }];
  const database: FakeDatabase = { id: 3, name: 'DB' };
  const withSource = withPcdSource(rows, database);

  assertEquals(withSource[0], {
    name: 'first',
    id: 4,
    sourceDatabaseName: 'DB',
    sourceType: 'pcd',
    sourceDatabaseId: 3,
  });
});

Deno.test('sortRowsByNameAndSource sorts by name then source comparator', () => {
  const rows = [
    { name: 'Second', sourceDatabaseName: 'C', id: 2 },
    { name: 'Second', sourceDatabaseName: 'A', id: 1 },
    { name: 'First', sourceDatabaseName: 'B', id: 1 },
  ];

  const sorted = sortRowsByNameAndSource(rows, (left, right) =>
    left.sourceDatabaseName.localeCompare(right.sourceDatabaseName)
  );

  assertEquals(sorted[0].sourceDatabaseName, 'B');
  assertEquals(sorted[1].sourceDatabaseName, 'A');
  assertEquals(sorted[2].sourceDatabaseName, 'C');
});

Deno.test('listTrashSourcesSafely returns empty array for uninitialized DB only', () => {
  const result = listTrashSourcesSafely({
    listSources: throwNotInitialized,
    onDatabaseNotInitialized: (error) => {
      assertInstanceOf(error, DatabaseNotInitializedError);
    },
  });

  assertEquals(result, []);
});

Deno.test('resolveDatabases rethrows non-initialization errors', () => {
  assertThrows(
    () =>
      resolveDatabases({
        resolveDatabases: () => {
          throw new Error('broken');
        },
        onDatabaseNotInitialized: () => {
          throw new Error('unexpected callback');
        },
      }),
    Error,
    'broken'
  );
});

Deno.test('resolveDatabases rethrows database initialization errors after callback', () => {
  assertThrows(
    () =>
      resolveDatabases({
        resolveDatabases: throwNotInitialized,
        onDatabaseNotInitialized: (error) => {
          assertInstanceOf(error, DatabaseNotInitializedError);
        },
      }),
    DatabaseNotInitializedError
  );
});
