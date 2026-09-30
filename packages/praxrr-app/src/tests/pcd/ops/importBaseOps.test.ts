import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { databaseInstancesQueries, type DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries, type ListPcdOpsOptions, type PcdOp } from '$db/queries/pcdOps.ts';
import * as importBaseOpsModule from '$pcd/ops/importBaseOps.ts';
import { PCDCache } from '$pcd/database/cache.ts';
import { getCache, getRegisteredCache, setCache, deleteCache } from '$pcd/database/registry.ts';
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
  __testOnly_setGetRegisteredCache,
  __testOnly_resetGetRegisteredCache,
  __testOnly_setBuildImportCache,
  __testOnly_resetBuildImportCache,
} = importBaseOpsModule;

function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K], restores: Restore[]): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

/**
 * Fake import/registered cache for unit tests. `prepareGet` is the row returned by
 * `rawDb.prepare(...).get(...)` — `undefined` means the entity is absent, a row means
 * present. Tracks `closed` so tests can assert lifecycle ownership.
 */
function fakeCache(prepareGet: () => unknown, state?: { closed: boolean }): PCDCache {
  return {
    getRawDb: () => ({
      prepare: () => ({
        get: prepareGet,
      }),
    }),
    close: () => {
      if (state) state.closed = true;
    },
  } as unknown as PCDCache;
}

function absentCache(state?: { closed: boolean }): PCDCache {
  return fakeCache(() => undefined, state);
}

function presentCache(state?: { closed: boolean }): PCDCache {
  return fakeCache(() => ({ exists_in_cache: 1 }), state);
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

    const importCache = presentCache();
    __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
    restores.push(__testOnly_resetBuildImportCache);
    __testOnly_setGetCache(() => importCache);
    restores.push(__testOnly_resetGetCache);

    patch(pcdOpsQueries, 'listByDatabaseAndOrigin', () => [], restores);

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

Deno.test('importBaseOps: reimports entities already present in published repo base ops', async () => {
  const restores: Restore[] = [];
  const databaseId = 9207;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-refresh-seen-' });
  const updates: Array<{ id: number; state?: string; lastSeenInRepoAt?: string | null }> = [];

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

    const importCache = absentCache();
    __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
    restores.push(__testOnly_resetBuildImportCache);
    __testOnly_setGetCache(() => importCache);
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

    patch(
      pcdOpsQueries,
      'update',
      (_id: number, input: { state?: string; lastSeenInRepoAt?: string | null }) => {
        updates.push({ id: _id, state: input.state, lastSeenInRepoAt: input.lastSeenInRepoAt });
        return true;
      },
      restores
    );

    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);

    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    const result = await importBaseOps(databaseId, tempDir);

    assertEquals(result.imported, 1);
    assertEquals(result.orphaned, 0);
    // No pcd_ops state changes happen during the import: refresh rows are rewritten in
    // place by the writer and only markBaseOrphaned touches state (after the loop).
    assertEquals(updates, []);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('importBaseOps: matches legacy published base ops by entity filename prefix', async () => {
  const restores: Restore[] = [];
  const databaseId = 9210;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-filename-prefix-' });
  const updates: Array<{ id: number; state?: string; lastSeenInRepoAt?: string | null }> = [];
  const deserialized: string[] = [];

  try {
    __testOnly_setReadMigrationEntitySources(() =>
      Promise.resolve({
        candidates: [
          buildCandidate(
            'custom-formats/not-original-or-english.yaml',
            'custom_format',
            {
              key: 'custom_format_name',
              value: 'Not Original or English',
              kind: 'stable',
            },
            () => {
              deserialized.push('custom-formats/not-original-or-english.yaml');
              return Promise.resolve({ success: true });
            }
          ),
        ],
        issues: [],
      })
    );
    restores.push(__testOnly_resetReadMigrationEntitySources);

    const importCache = absentCache();
    __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
    restores.push(__testOnly_resetBuildImportCache);
    __testOnly_setGetCache(() => importCache);
    restores.push(__testOnly_resetGetCache);

    patch(
      pcdOpsQueries,
      'listByDatabaseAndOrigin',
      (_databaseId: number, _origin: 'base' | 'user', _options?: ListPcdOpsOptions) => [
        {
          id: 7301,
          database_id: databaseId,
          origin: 'base',
          state: 'published',
          source: 'local',
          filename: 'entities/custom-formats/not-original-or-english.yaml#00000.sql',
          op_number: null,
          sequence: 4_000_000_000,
          sql: 'INSERT INTO custom_formats (name) VALUES ("Not Original or English");',
          metadata: null,
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

    patch(
      pcdOpsQueries,
      'update',
      (id: number, input: { state?: string; lastSeenInRepoAt?: string | null }) => {
        updates.push({ id, state: input.state, lastSeenInRepoAt: input.lastSeenInRepoAt });
        return true;
      },
      restores
    );

    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);

    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    const result = await importBaseOps(databaseId, tempDir);

    assertEquals(result.imported, 1);
    assertEquals(result.orphaned, 0);
    assertEquals(deserialized, ['custom-formats/not-original-or-english.yaml']);
    assertEquals(updates, []);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  'importBaseOps: reimports refresh candidates even when the stale registered cache still shows the entity',
  async () => {
    const restores: Restore[] = [];
    const databaseId = 9208;
    const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-refresh-in-place-' });
    const updates: Array<{ id: number; state?: string; lastSeenInRepoAt?: string | null }> = [];
    const deserialized: string[] = [];

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
                deserialized.push('quality-profiles/default.yaml');
                return Promise.resolve({ success: true });
              }
            ),
          ],
          issues: [],
        })
      );
      restores.push(__testOnly_resetReadMigrationEntitySources);

      const importCache = absentCache();
      __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
      restores.push(__testOnly_resetBuildImportCache);
      __testOnly_setGetCache(() => importCache);
      restores.push(__testOnly_resetGetCache);

      // Stale registered cache: the entity still resolves here, which must NOT skip a
      // refresh candidate (it is rewritten in place, not re-created).
      __testOnly_setGetRegisteredCache(() => presentCache());
      restores.push(__testOnly_resetGetRegisteredCache);

      patch(
        pcdOpsQueries,
        'listByDatabaseAndOrigin',
        (_databaseId: number, _origin: 'base' | 'user', _options?: ListPcdOpsOptions) => [
          {
            id: 7101,
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

      patch(
        pcdOpsQueries,
        'update',
        (id: number, input: { state?: string; lastSeenInRepoAt?: string | null }) => {
          updates.push({ id, state: input.state, lastSeenInRepoAt: input.lastSeenInRepoAt });
          return true;
        },
        restores
      );

      patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);

      __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
      restores.push(__testOnly_resetCompile);

      const result = await importBaseOps(databaseId, tempDir);

      assertEquals(result.imported, 1);
      assertEquals(result.orphaned, 0);
      assertEquals(deserialized, ['quality-profiles/default.yaml']);
      assertEquals(updates, []);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await Deno.remove(tempDir, { recursive: true });
    }
  }
);

Deno.test('importBaseOps: skips non-refresh entity present in the registered cache', async () => {
  const restores: Restore[] = [];
  const databaseId = 9209;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-skip-registered-' });
  const deserialized: string[] = [];

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
              deserialized.push('quality-profiles/default.yaml');
              return Promise.resolve({ success: true });
            }
          ),
        ],
        issues: [],
      })
    );
    restores.push(__testOnly_resetReadMigrationEntitySources);

    const importCache = absentCache();
    __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
    restores.push(__testOnly_resetBuildImportCache);
    __testOnly_setGetCache(() => importCache);
    restores.push(__testOnly_resetGetCache);

    // No matching published repo op -> not a refresh. The entity exists in the
    // registered cache (e.g. user-created or base draft), so it must skip.
    __testOnly_setGetRegisteredCache(() => presentCache());
    restores.push(__testOnly_resetGetRegisteredCache);

    patch(pcdOpsQueries, 'listByDatabaseAndOrigin', () => [], restores);
    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);

    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    const result = await importBaseOps(databaseId, tempDir);

    assertEquals(result.imported, 0);
    assertEquals(result.orphaned, 0);
    assertEquals(deserialized, []);
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
    __testOnly_setBuildImportCache(() => Promise.resolve(absentCache()));
    restores.push(__testOnly_resetBuildImportCache);
    patch(pcdOpsQueries, 'listByDatabaseAndOrigin', () => [], restores);
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

      __testOnly_setBuildImportCache(() =>
        Promise.resolve({
          getRawDb: (() => ({})) as unknown as PCDCache['getRawDb'],
          close: () => {},
        } as unknown as PCDCache)
      );
      restores.push(__testOnly_resetBuildImportCache);

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

Deno.test(
  'importBaseOps: loadAllOperations excludes refresh ops but keeps other published and draft base ops',
  async () => {
    const restores: Restore[] = [];
    const databaseId = 9214;
    const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-ops-exclude-' });

    try {
      const publishedKeep: PcdOp = {
        id: 600,
        database_id: databaseId,
        origin: 'base',
        state: 'published',
        source: 'repo',
        filename: '1.keep.sql',
        op_number: 1,
        sequence: 1,
        sql: 'CREATE TABLE keep_marker (id INTEGER PRIMARY KEY);',
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
      const publishedRefresh: PcdOp = {
        ...publishedKeep,
        id: 601,
        filename: '2.refresh.sql',
        op_number: 2,
        sequence: 2,
        sql: 'CREATE TABLE refresh_marker (id INTEGER PRIMARY KEY);',
      };
      const draftKeep: PcdOp = {
        ...publishedKeep,
        id: 602,
        state: 'draft',
        source: 'local',
        filename: '3.draft.sql',
        op_number: 3,
        sequence: 3,
        sql: 'CREATE TABLE draft_marker (id INTEGER PRIMARY KEY);',
      };

      patch(
        pcdOpsQueries,
        'listByDatabaseAndOrigin',
        (_databaseId: number, origin: 'base' | 'user', options?: ListPcdOpsOptions) => {
          if (origin !== 'base') return [];
          const rows = [publishedKeep, publishedRefresh, draftKeep];
          if (options?.states?.length) {
            return rows.filter((row) => options.states!.includes(row.state));
          }
          return rows;
        },
        restores
      );

      const operations = await loadAllOperations(tempDir, databaseId, {
        excludeBaseOpIds: new Set([publishedRefresh.id]),
      });

      const filenames = operations.map((operation) => operation.filename);
      assertEquals(filenames.includes('1.keep.sql'), true);
      assertEquals(filenames.includes('2.refresh.sql'), false);
      assertEquals(filenames.includes('3.draft.sql'), true);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await Deno.remove(tempDir, { recursive: true });
    }
  }
);

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

// ---------------------------------------------------------------------------
// YAN-461 regression coverage
// ---------------------------------------------------------------------------

function repoBaseOp(id: number, filename: string, name: string, sql: string): PcdOp {
  return {
    id,
    database_id: 0,
    origin: 'base',
    state: 'published',
    source: 'repo',
    filename,
    op_number: null,
    sequence: 4_000_000_000,
    sql,
    metadata: JSON.stringify({
      operation: 'create',
      entity: 'custom_format',
      name,
      stable_key: { key: 'custom_format_name', value: name },
    }),
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function userOp(id: number, name: string): PcdOp {
  return {
    id,
    database_id: 0,
    origin: 'user',
    state: 'published',
    source: 'local',
    filename: null,
    op_number: null,
    sequence: null,
    sql: `UPDATE custom_formats SET description = 'user tweak' WHERE name = '${name}';`,
    metadata: JSON.stringify({
      operation: 'update',
      entity: 'custom_format',
      name,
      changed_fields: ['description'],
    }),
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

Deno.test(
  'importBaseOps: refresh pass keeps user ops untouched and compiles exactly once after orphaning (YAN-461)',
  async () => {
    const restores: Restore[] = [];
    const databaseId = 9211;
    const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-user-ops-survive-' });
    const events: string[] = [];
    const droppedUpdates: Array<{ id: number; state?: string }> = [];

    try {
      const baseRow = repoBaseOp(7001, 'entities/custom-formats/legacy.yaml#00000.sql', 'Legacy Custom', 'INSERT 1');
      const userRow = userOp(9001, 'Legacy Custom');

      __testOnly_setReadMigrationEntitySources(() =>
        Promise.resolve({
          candidates: [
            buildCandidate(
              'custom-formats/legacy.yaml',
              'custom_format',
              {
                key: 'custom_format_name',
                value: 'Legacy Custom',
                kind: 'stable',
              },
              () => Promise.resolve({ success: true })
            ),
          ],
          issues: [],
        })
      );
      restores.push(__testOnly_resetReadMigrationEntitySources);

      const importCache = absentCache();
      __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
      restores.push(__testOnly_resetBuildImportCache);
      __testOnly_setGetCache(() => importCache);
      restores.push(__testOnly_resetGetCache);
      __testOnly_setGetRegisteredCache(() => presentCache());
      restores.push(__testOnly_resetGetRegisteredCache);

      patch(
        pcdOpsQueries,
        'listByDatabaseAndOrigin',
        (_databaseId: number, origin: 'base' | 'user', _options?: ListPcdOpsOptions) =>
          origin === 'base' ? [baseRow] : [userRow],
        restores
      );

      patch(
        pcdOpsQueries,
        'update',
        (id: number, input: { state?: string }) => {
          if (input.state === 'dropped' || input.state === 'orphaned') {
            droppedUpdates.push({ id, state: input.state });
          }
          return true;
        },
        restores
      );

      patch(
        pcdOpHistoryQueries,
        'create',
        () => {
          events.push('history');
          return 1;
        },
        restores
      );

      patch(
        pcdOpsQueries,
        'markBaseOrphaned',
        () => {
          events.push('markBaseOrphaned');
          return 0;
        },
        restores
      );

      __testOnly_setCompile(() => {
        events.push('compile');
        return Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 });
      });
      restores.push(__testOnly_resetCompile);

      const result = await importBaseOps(databaseId, tempDir);

      assertEquals(result.imported, 1);
      // The regression (YAN-461): user ops are never dropped and repo base ops are never
      // orphaned during the import — the value-guard gate only runs inside compile(),
      // which must fire exactly once, after markBaseOrphaned, with the complete base.
      assertEquals(droppedUpdates, []);
      assertEquals(events, ['markBaseOrphaned', 'compile']);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await Deno.remove(tempDir, { recursive: true });
    }
  }
);

Deno.test('importBaseOps: routes deep getCache calls to the scoped import cache (real registry)', async () => {
  const restores: Restore[] = [];
  const databaseId = 9213;
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-scoped-registry-' });

  try {
    const registered = absentCache();
    setCache(databaseId, registered);
    restores.push(() => {
      deleteCache(databaseId);
    });

    let cacheSeenByDeserialize: unknown;
    let cacheSeenByWriterContext: unknown;

    const candidate = buildCandidate(
      'custom-formats/alpha.yaml',
      'custom_format',
      { key: 'custom_format_name', value: 'Alpha', kind: 'stable' },
      () => Promise.resolve({ success: true })
    );
    (candidate as unknown as { deserialize: (options: { cache: unknown }) => Promise<unknown> }).deserialize = (
      options
    ) => {
      cacheSeenByDeserialize = options.cache;
      return Promise.resolve({ success: true });
    };

    __testOnly_setReadMigrationEntitySources(() => Promise.resolve({ candidates: [candidate], issues: [] }));
    restores.push(__testOnly_resetReadMigrationEntitySources);

    const importCache = absentCache();
    __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
    restores.push(__testOnly_resetBuildImportCache);

    __testOnly_setWithRepoImportWriteContext((_context, callback: () => Promise<unknown>) => {
      // Deep writer-path getCache() lookup inside the scope must resolve to the
      // scoped import cache, not the registered one.
      cacheSeenByWriterContext = getCache(databaseId);
      return callback();
    });
    restores.push(__testOnly_resetWithRepoImportWriteContext);

    patch(pcdOpsQueries, 'listByDatabaseAndOrigin', () => [], restores);
    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);
    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);

    const result = await importBaseOps(databaseId, tempDir);

    assertEquals(result.imported, 1);
    assertEquals(cacheSeenByDeserialize === importCache, true);
    assertEquals(cacheSeenByWriterContext === importCache, true);
    // Outside the import the registered cache is untouched.
    assertEquals(getRegisteredCache(databaseId) === registered, true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  'importBaseOps: failed import restores repo base ops from snapshot and does not compile (YAN-461)',
  async () => {
    const restores: Restore[] = [];
    const databaseId = 9212;
    const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-failure-restore-' });
    const restoreCalls: Array<{ id: number; state?: string; sql?: string; lastSeenInRepoAt?: string | null }> = [];
    let compileCalls = 0;
    let nextCreatedId = 7100;

    try {
      const baseRow = repoBaseOp(
        7001,
        'entities/custom-formats/alpha.yaml#00000.sql',
        'Alpha',
        'INSERT INTO custom_formats ...'
      );

      // Mutable in-memory pcd_ops table: rows created/updated by the (stubbed) writer
      // must be visible to the snapshot restore.
      const baseRows = new Map<number, PcdOp>([[baseRow.id, { ...baseRow }]]);

      __testOnly_setReadMigrationEntitySources(() =>
        Promise.resolve({
          candidates: [
            buildCandidate(
              'custom-formats/alpha.yaml',
              'custom_format',
              {
                key: 'custom_format_name',
                value: 'Alpha',
                kind: 'stable',
              },
              () => {
                // Simulate the writer: rewrite the matched repo op in place.
                baseRows.set(7001, {
                  ...baseRow,
                  sql: 'REWRITTEN SQL',
                  last_seen_in_repo_at: new Date().toISOString(),
                });
                return Promise.resolve({ success: true });
              }
            ),
            buildCandidate(
              'custom-formats/beta.yaml',
              'custom_format',
              {
                key: 'custom_format_name',
                value: 'Beta',
                kind: 'stable',
              },
              () => {
                // Simulate the writer creating a new op row, then the import failing.
                nextCreatedId += 1;
                baseRows.set(
                  nextCreatedId,
                  repoBaseOp(nextCreatedId, `entities/custom-formats/beta.yaml#00000.sql`, 'Beta', 'INSERT BETA')
                );
                return Promise.reject(new Error('beta deserialize failure'));
              }
            ),
          ],
          issues: [],
        })
      );
      restores.push(__testOnly_resetReadMigrationEntitySources);

      const importCache = absentCache();
      __testOnly_setBuildImportCache(() => Promise.resolve(importCache));
      restores.push(__testOnly_resetBuildImportCache);
      __testOnly_setGetCache(() => importCache);
      restores.push(__testOnly_resetGetCache);

      patch(
        pcdOpsQueries,
        'listByDatabaseAndOrigin',
        (_databaseId: number, origin: 'base' | 'user', options?: ListPcdOpsOptions) => {
          if (origin !== 'base') return [];
          const rows = Array.from(baseRows.values());
          if (options?.states?.length) {
            return rows.filter((row) => options.states!.includes(row.state));
          }
          return rows;
        },
        restores
      );

      patch(
        pcdOpsQueries,
        'update',
        (id: number, input: { state?: PcdOp['state']; sql?: string; lastSeenInRepoAt?: string | null }) => {
          const row = baseRows.get(id);
          if (row) {
            baseRows.set(id, {
              ...row,
              state: input.state ?? row.state,
              sql: input.sql ?? row.sql,
              last_seen_in_repo_at: input.lastSeenInRepoAt ?? row.last_seen_in_repo_at,
            });
          }
          restoreCalls.push({ id, state: input.state, sql: input.sql, lastSeenInRepoAt: input.lastSeenInRepoAt });
          return true;
        },
        restores
      );

      patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);

      __testOnly_setCompile(() => {
        compileCalls += 1;
        return Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 });
      });
      restores.push(__testOnly_resetCompile);

      await assertRejects(
        async () => {
          await importBaseOps(databaseId, tempDir);
        },
        Error,
        'beta deserialize failure'
      );

      // The rewritten repo op is restored to its snapshot fields; the op created during
      // the failed run is orphaned; the final compile never ran.
      const alphaRestore = restoreCalls.find((call) => call.id === 7001);
      assertEquals(alphaRestore !== undefined, true);
      assertEquals(alphaRestore?.sql, 'INSERT INTO custom_formats ...');
      assertEquals(alphaRestore?.state, 'published');
      assertEquals(alphaRestore?.lastSeenInRepoAt, null);

      const betaRestore = restoreCalls.find((call) => call.id === nextCreatedId);
      assertEquals(betaRestore !== undefined, true);
      assertEquals(betaRestore?.state, 'orphaned');

      assertEquals(compileCalls, 0);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await Deno.remove(tempDir, { recursive: true });
    }
  }
);
