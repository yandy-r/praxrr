import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { databaseInstancesQueries, type DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries, type ListPcdOpsOptions, type PcdOp } from '$db/queries/pcdOps.ts';
import * as importBaseOpsModule from '$pcd/ops/importBaseOps.ts';
import { PCDCache } from '$pcd/database/cache.ts';
import type {
  MigrationEntityCandidate,
  MigrationReaderIssue,
  MigrationEntityStableIdentity,
} from '$pcd/migration/reader.ts';
import { loadAllOperations } from '$pcd/ops/loadOps.ts';

type Restore = () => void;

type TestStableIdentity = MigrationEntityStableIdentity;

type TestStableIdentityEntry = {
  stableIdentity: TestStableIdentity | null;
  sourcePath: string;
};

function migrationEntry(identity: TestStableIdentity | null, sourcePath: string): TestStableIdentityEntry {
  return {
    stableIdentity: identity,
    sourcePath,
  };
}

const { __testOnly_validateStableIdentityConflicts, importBaseOps, MigrationReaderError } = importBaseOpsModule;
const {
  __testOnly_setReadMigrationEntitySources,
  __testOnly_resetReadMigrationEntitySources,
  __testOnly_setCompile,
  __testOnly_resetCompile,
  __testOnly_setWithRepoImportWriteContext,
  __testOnly_resetWithRepoImportWriteContext,
  __testOnly_setGetCache,
  __testOnly_resetGetCache,
} = importBaseOpsModule;

function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K], restores: Restore[]): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function buildCandidate(
  relativePath: string,
  entityType: MigrationEntityCandidate['entityType'],
  stableIdentity: TestStableIdentity,
  deserialize: () => Promise<{ success: boolean }>
): MigrationEntityCandidate {
  return {
    sourcePath: `/tmp/${relativePath}`,
    relativePath,
    entityType,
    migration: {
      source: `entities/${relativePath}`,
      format: 'yaml',
      version: 1,
    },
    portable: {
      name: stableIdentity.value,
    },
    entityName: stableIdentity.value,
    identity: {
      kind: 'identity',
      key: 'migration:custom_format',
      value: stableIdentity.value,
    },
    stableIdentity,
    deserialize,
  } as unknown as MigrationEntityCandidate;
}

Deno.test('importBaseOps: validateStableIdentityConflicts detects migration duplicate identities', () => {
  const identity: TestStableIdentity = {
    key: 'quality_profile_name',
    value: 'Existing Profile',
    kind: 'stable',
  };

  assertThrows(
    () => {
      __testOnly_validateStableIdentityConflicts([
        migrationEntry(identity, '/path/entity-1.yaml'),
        migrationEntry(identity, '/path/entity-2.yaml'),
      ]);
    },
    Error,
    'migration/duplicate'
  );
});

Deno.test(
  'importBaseOps: validateStableIdentityConflicts ignores null and allows distinct migration identities',
  () => {
    __testOnly_validateStableIdentityConflicts([
      migrationEntry(null, '/path/entity.yaml'),
      migrationEntry(null, '/path/other.yaml'),
      migrationEntry(
        {
          key: 'quality_profile_name',
          value: 'Existing Profile',
          kind: 'stable',
        },
        '/path/first.yaml'
      ),
      migrationEntry(
        {
          key: 'custom_format_name',
          value: 'Custom Format',
          kind: 'stable',
        },
        '/path/second.yaml'
      ),
    ]);
  }
);

Deno.test('importBaseOps: throws on duplicate migration stable identities during import', async () => {
  const restores: Restore[] = [];
  const databaseId = 9200;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-conflict-' });

  const first: TestStableIdentity = {
    key: 'custom_format_name',
    value: 'Conflict',
    kind: 'stable',
  };

  const second: TestStableIdentity = {
    key: 'custom_format_name',
    value: 'Conflict',
    kind: 'stable',
  };

  try {
    __testOnly_setReadMigrationEntitySources(() =>
      Promise.resolve({
        candidates: [
          buildCandidate('custom-formats/conflict-1.yaml', 'custom_format', first, () =>
            Promise.resolve({ success: true })
          ),
          buildCandidate('custom-formats/conflict-2.yaml', 'custom_format', second, () =>
            Promise.resolve({ success: true })
          ),
        ],
        issues: [],
      })
    );
    restores.push(__testOnly_resetReadMigrationEntitySources);

    __testOnly_setGetCache(
      () => ({ getRawDb: (() => ({})) as unknown as PCDCache['getRawDb'] }) as unknown as PCDCache
    );
    restores.push(__testOnly_resetGetCache);
    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    await assertRejects(
      async () => {
        await importBaseOps(databaseId, tempDir);
      },
      Error,
      'migration/duplicate'
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('importBaseOps: skips entities already present in the base cache', async () => {
  const restores: Restore[] = [];
  const databaseId = 9206;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-skip-existing-' });
  const calls: string[] = [];

  try {
    __testOnly_setReadMigrationEntitySources(() =>
      Promise.resolve({
        candidates: [
          buildCandidate(
            'quality-profiles/default.yaml',
            'quality_profile',
            {
              key: 'quality_profile_name',
              value: 'Default',
              kind: 'stable',
            },
            () => {
              calls.push('quality_profile');
              return Promise.resolve({ success: true });
            }
          ),
          buildCandidate(
            'custom-formats/legacy.yaml',
            'custom_format',
            {
              key: 'custom_format_name',
              value: 'Legacy Custom',
              kind: 'stable',
            },
            () => {
              calls.push('custom_format');
              return Promise.resolve({ success: true });
            }
          ),
        ],
        issues: [],
      })
    );
    restores.push(__testOnly_resetReadMigrationEntitySources);

    __testOnly_setGetCache(
      () =>
        ({
          getRawDb: () => ({
            prepare: () => ({
              get: () => ({ exists_in_cache: 1 }),
            }),
          }),
        }) as unknown as PCDCache
    );
    restores.push(__testOnly_resetGetCache);

    patch(
      pcdOpsQueries,
      'listByDatabaseAndOrigin',
      () => [],
      restores
    );

    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);

    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    const result = await importBaseOps(databaseId, tempDir);

    assertEquals(result.imported, 0);
    assertEquals(result.orphaned, 0);
    assertEquals(calls, []);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('importBaseOps: refreshes last_seen_in_repo_at when an entity already exists in published repo base ops', async () => {
  const restores: Restore[] = [];
  const databaseId = 9207;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-refresh-seen-' });
  const updates: Array<{ id: number; lastSeenInRepoAt: string | null | undefined }> = [];
  let seenAtFromImport: string | null = null;

  try {
    __testOnly_setReadMigrationEntitySources(() =>
      Promise.resolve({
        candidates: [
          buildCandidate(
            'quality-profiles/default.yaml',
            'quality_profile',
            {
              key: 'quality_profile_name',
              value: 'Default',
              kind: 'stable',
            },
            () => Promise.resolve({ success: true })
          ),
        ],
        issues: [],
      })
    );
    restores.push(__testOnly_resetReadMigrationEntitySources);

    __testOnly_setGetCache(
      () =>
        ({
          getRawDb: () => ({
            prepare: () => ({
              get: () => undefined,
            }),
          }),
        }) as unknown as PCDCache
    );
    restores.push(__testOnly_resetGetCache);

    patch(
      pcdOpsQueries,
      'listByDatabaseAndOrigin',
      (_databaseId: number, _origin: 'base' | 'user', _options?: ListPcdOpsOptions) => [
        {
          id: 7001,
          database_id: databaseId,
          origin: 'base',
          state: 'published',
          source: 'repo',
          filename: 'entities/quality-profiles/default.yaml#00000.sql',
          op_number: null,
          sequence: 4_000_000_000,
          sql: 'INSERT INTO quality_profiles (name) VALUES ("Default");',
          metadata: JSON.stringify({
            operation: 'create',
            entity: 'quality_profile',
            name: 'Default',
            stable_key: {
              key: 'quality_profile_name',
              value: 'Default',
            },
          }),
          desired_state: null,
          content_hash: null,
          last_seen_in_repo_at: null,
          superseded_by_op_id: null,
          pushed_at: null,
          pushed_commit: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      restores
    );

    patch(pcdOpsQueries, 'update', (_id: number, input: { lastSeenInRepoAt?: string | null }) => {
      updates.push({ id: _id, lastSeenInRepoAt: input.lastSeenInRepoAt });
      if (typeof input.lastSeenInRepoAt === 'string') {
        seenAtFromImport = input.lastSeenInRepoAt;
      }
      return true;
    }, restores);

    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);

    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    const result = await importBaseOps(databaseId, tempDir);

    assertEquals(result.imported, 0);
    assertEquals(result.orphaned, 0);
    assertEquals(updates.length, 1);
    assertEquals(updates[0].id, 7001);
    assertEquals(typeof seenAtFromImport, 'string');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('importBaseOps: throws MigrationReaderError when migration reader returns issues', async () => {
  const restores: Restore[] = [];
  const databaseId = 9204;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-reader-issues-' });

  try {
    __testOnly_setReadMigrationEntitySources(() =>
      Promise.resolve({
        candidates: [],
        issues: [
          {
            relativePath: 'media-management/radarr-naming/bad.yaml',
            kind: 'parse-error',
            message: 'invalid YAML payload',
          } as MigrationReaderIssue,
        ],
      })
    );
    restores.push(__testOnly_resetReadMigrationEntitySources);

    await assertRejects(
      async () => {
        await importBaseOps(databaseId, tempDir);
      },
      MigrationReaderError,
      'media-management/radarr-naming/bad.yaml'
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('importBaseOps: throws when base cache is unavailable', async () => {
  const restores: Restore[] = [];
  const databaseId = 9205;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-cache-missing-' });

  try {
    __testOnly_setReadMigrationEntitySources(() =>
      Promise.resolve({
        candidates: [
          buildCandidate(
            'quality-profiles/default.yaml',
            'quality_profile',
            {
              key: 'quality_profile_name',
              value: 'Default',
              kind: 'stable',
            },
            () => Promise.resolve({ success: true })
          ),
        ],
        issues: [],
      })
    );
    restores.push(__testOnly_resetReadMigrationEntitySources);

    __testOnly_setGetCache(() => undefined as unknown as PCDCache);
    restores.push(__testOnly_resetGetCache);
    patch(
      pcdOpsQueries,
      'listByDatabaseAndOrigin',
      () => [],
      restores
    );
    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    await assertRejects(
      async () => {
        await importBaseOps(databaseId, tempDir);
      },
      Error,
      'Cache not available while importing migration entity "quality-profiles/default.yaml"'
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  'importBaseOps: imports YAML candidates in deterministic order and applies deterministic sequencing',
  async () => {
    const restores: Restore[] = [];
    const databaseId = 9201;
    const order: string[] = [];
    const seenContexts: Array<{ filenamePrefix: string; sequenceStart: number }> = [];
    const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-order-' });

    const candidates = [
      buildCandidate(
        'quality-profiles/zzz.yaml',
        'quality_profile',
        {
          key: 'quality_profile_name',
          value: 'Zulu',
          kind: 'stable',
        },
        () => {
          order.push('quality:Zulu');
          return Promise.resolve({ success: true });
        }
      ),
      buildCandidate(
        'custom-formats/alpha.yaml',
        'custom_format',
        {
          key: 'custom_format_name',
          value: 'Alpha',
          kind: 'stable',
        },
        () => {
          order.push('custom:Alpha');
          return Promise.resolve({ success: true });
        }
      ),
      buildCandidate(
        'custom-formats/zeta.yaml',
        'custom_format',
        {
          key: 'custom_format_name',
          value: 'Zeta',
          kind: 'stable',
        },
        () => {
          order.push('custom:Zeta');
          return Promise.resolve({ success: true });
        }
      ),
      buildCandidate(
        'regular-expressions/root.yaml',
        'regular_expression',
        {
          key: 'regular_expression_name',
          value: 'Root',
          kind: 'stable',
        },
        () => {
          order.push('regex:Root');
          return Promise.resolve({ success: true });
        }
      ),
    ];

    try {
      __testOnly_setReadMigrationEntitySources(() => Promise.resolve({ candidates, issues: [] }));
      restores.push(__testOnly_resetReadMigrationEntitySources);

    __testOnly_setGetCache(
      () => ({ getRawDb: (() => ({})) as unknown as PCDCache['getRawDb'] }) as unknown as PCDCache
    );
    restores.push(__testOnly_resetGetCache);

    patch(pcdOpsQueries, 'listByDatabaseAndOrigin', () => [], restores);
    patch(pcdOpsQueries, 'markBaseOrphaned', () => 1, restores);

      __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
      restores.push(__testOnly_resetCompile);

      __testOnly_setWithRepoImportWriteContext((context, callback: () => Promise<unknown>): Promise<unknown> => {
        seenContexts.push({
          filenamePrefix: context.filenamePrefix,
          sequenceStart: context.sequenceStart,
        });
        return callback();
      });
      restores.push(__testOnly_resetWithRepoImportWriteContext);

      const result = await importBaseOps(databaseId, tempDir);

      assertEquals(result.imported, 4);
      assertEquals(result.orphaned, 1);
      assertEquals(order, ['regex:Root', 'custom:Alpha', 'custom:Zeta', 'quality:Zulu']);
      assertEquals(seenContexts.length, 4);
      assertEquals(seenContexts[0].filenamePrefix, 'entities/regular-expressions/root.yaml');
      assertEquals(seenContexts[0].sequenceStart, 4_000_000_000);
      assertEquals(seenContexts[1].sequenceStart, 4_000_010_000);
      assertEquals(seenContexts[2].sequenceStart, 4_000_020_000);
      assertEquals(seenContexts[3].sequenceStart, 4_000_030_000);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await Deno.remove(tempDir, { recursive: true });
    }
  }
);

Deno.test('importBaseOps: loadAllOperations includes schema and tweaks SQL layers', async () => {
  const restores: Restore[] = [];
  const databaseId = 9202;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-ops-load-' });

  try {
    const schemaPath = `${tempDir}/deps/schema/ops`;
    const tweaksPath = `${tempDir}/tweaks`;
    await Deno.mkdir(schemaPath, { recursive: true });
    await Deno.mkdir(tweaksPath, { recursive: true });

    await Deno.writeTextFile(`${schemaPath}/0.schema.sql`, 'CREATE TABLE schema_marker (id INTEGER PRIMARY KEY);');
    await Deno.writeTextFile(`${schemaPath}/1.test.sql`, 'CREATE TABLE test_marker (id INTEGER PRIMARY KEY);');
    await Deno.writeTextFile(`${tweaksPath}/1.tweak.sql`, 'CREATE TABLE tweak_marker (id INTEGER PRIMARY KEY);');

    patch(
      pcdOpsQueries,
      'listByDatabaseAndOrigin',
      (_databaseId: number, _origin: 'base' | 'user', _options?: ListPcdOpsOptions) => [],
      restores
    );

    const operations = await loadAllOperations(tempDir, databaseId);

    assertEquals(
      operations.some((operation) => operation.layer === 'schema' && operation.filename === '0.schema.sql'),
      true
    );
    assertEquals(
      operations.some((operation) => operation.layer === 'tweaks' && operation.filename === '1.tweak.sql'),
      true
    );
    assertEquals(
      operations.findIndex((operation) => operation.layer === 'schema') <
        operations.findIndex((operation) => operation.layer === 'tweaks'),
      true
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('PCDCache: legacy SQL helper functions are preserved', async () => {
  const restores: Restore[] = [];
  const databaseId = 9203;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-cache-helpers-' });

  const schemaPath = `${tempDir}/deps/schema/ops`;
  const seedOp: PcdOp = {
    id: 500,
    database_id: databaseId,
    origin: 'base',
    state: 'published',
    source: 'repo',
    filename: '1.seed.sql',
    op_number: 1,
    sequence: 1,
    sql: [
      "INSERT INTO quality_profiles (name) VALUES ('Profile A');",
      "INSERT INTO custom_formats (name) VALUES ('Custom A');",
      "INSERT INTO delay_profiles (name) VALUES ('Delay A');",
      "INSERT INTO lidarr_metadata_profiles (name) VALUES ('Metadata A');",
      "INSERT INTO tags (name) VALUES ('Tag A');",
    ].join('\n'),
    metadata: null,
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const helperOp: PcdOp = {
    id: 501,
    database_id: databaseId,
    origin: 'base',
    state: 'published',
    source: 'repo',
    filename: '2.helpers.sql',
    op_number: 2,
    sequence: 2,
    sql: [
      'INSERT INTO legacy_helper_probe (',
      '  quality_profile_id,',
      '  custom_format_id,',
      '  delay_profile_id,',
      '  metadata_profile_id,',
      '  tag_id',
      ') VALUES (',
      "  qp('Profile A'),",
      "  cf('Custom A'),",
      "  dp('Delay A'),",
      "  mp('Metadata A'),",
      "  tag('Tag A')",
      ')',
    ].join('\n'),
    metadata: null,
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const baseOps = [seedOp, helperOp];

  const schemaSql = [
    'CREATE TABLE quality_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);',
    'CREATE TABLE custom_formats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);',
    'CREATE TABLE delay_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);',
    'CREATE TABLE lidarr_metadata_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);',
    'CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);',
    'CREATE TABLE legacy_helper_probe (',
    '  quality_profile_id INTEGER NOT NULL,',
    '  custom_format_id INTEGER NOT NULL,',
    '  delay_profile_id INTEGER NOT NULL,',
    '  metadata_profile_id INTEGER NOT NULL,',
    '  tag_id INTEGER NOT NULL',
    ');',
  ].join('\n');

  try {
    await Deno.mkdir(schemaPath, { recursive: true });
    await Deno.writeTextFile(`${schemaPath}/0.schema.sql`, schemaSql);

    patch(
      databaseInstancesQueries,
      'getById',
      () =>
        ({
          id: databaseId,
          uuid: 'cache-helper-preservation',
          name: 'Cache Helper Probe',
          repository_url: 'file:///tmp/cache-helper-preservation',
          local_path: tempDir,
          sync_strategy: 0,
          auto_pull: 1,
          enabled: 1,
          personal_access_token: null,
          is_private: 0,
          local_ops_enabled: 0,
          git_user_name: null,
          git_user_email: null,
          conflict_strategy: 'override',
          last_synced_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }) as DatabaseInstance,
      restores
    );

    patch(
      pcdOpsQueries,
      'listByDatabaseAndOrigin',
      (_databaseId: number, origin: 'base' | 'user', options?: ListPcdOpsOptions) => {
        if (origin === 'base' && options?.states?.includes('published')) return baseOps;
        return [];
      },
      restores
    );

    patch(pcdOpHistoryQueries, 'create', () => 1, restores);
    patch(pcdOpHistoryQueries, 'listLatestByDatabaseWithOps', () => [], restores);

    const cache = new PCDCache(tempDir, databaseId);
    const stats = await cache.build();
    assertEquals(stats.schema > 0, true);

    const rows = cache.query<{
      quality_profile_id: number;
      custom_format_id: number;
      delay_profile_id: number;
      metadata_profile_id: number;
      tag_id: number;
    }>(
      'SELECT quality_profile_id, custom_format_id, delay_profile_id, metadata_profile_id, tag_id FROM legacy_helper_probe'
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0].quality_profile_id, 1);
    assertEquals(rows[0].custom_format_id, 1);
    assertEquals(rows[0].delay_profile_id, 1);
    assertEquals(rows[0].metadata_profile_id, 1);
    assertEquals(rows[0].tag_id, 1);

    cache.close();
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});
