import { assertEquals, assertRejects } from '@std/assert';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import {
  __testOnly_resetCompile,
  __testOnly_resetGetCache,
  __testOnly_resetReadMigrationEntitySources,
  __testOnly_resetWithRepoImportWriteContext,
  importBaseOps,
  __testOnly_setCompile,
  __testOnly_setGetCache,
  __testOnly_setReadMigrationEntitySources,
  __testOnly_setWithRepoImportWriteContext,
} from '$pcd/ops/importBaseOps.ts';
import type { MigrationEntityCandidate, MigrationEntityStableIdentity } from '$pcd/migration/reader.ts';
import type { PCDCache } from '$pcd/database/cache.ts';

type Restore = () => void;

type TestCandidate = {
  readonly calls: string[];
  readonly candidate: MigrationEntityCandidate;
};

function buildTestCandidate(
  relativePath: string,
  result: { success: boolean; error?: string },
  calls: string[]
): TestCandidate {
  const stableIdentity: MigrationEntityStableIdentity = {
    key: 'quality_profile_name',
    value: 'Flow Test Profile',
    kind: 'stable',
  };

  return {
    calls,
    candidate: {
      sourcePath: `/tmp/entities/${relativePath}`,
      relativePath,
      entityType: 'quality_profile',
      migration: {
        format: 'yaml',
        version: 1,
        source: 'praxrr-test',
      },
      portable: {},
      entityName: 'Flow Test Profile',
      identity: {
        kind: 'identity',
        key: 'quality_profile_name',
        value: 'Flow Test Profile',
      },
      stableIdentity,
      deserialize: () => {
        calls.push(relativePath);
        return Promise.resolve(result);
      },
    },
  };
}

function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K], restores: Restore[]): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('pcdManager: import orchestration surfaces import failures directly', async () => {
  const restores: Restore[] = [];
  const databaseId = 9010;
  const calls: string[] = [];

  function restoreAll(): void {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  }

  try {
    const { candidate } = buildTestCandidate('quality-profiles/failing.yaml', { success: false, error: 'mock import failure' }, calls);

    patch(
      pcdOpsQueries,
      'markBaseOrphaned',
      () => {
        return 0;
      },
      restores
    );
    __testOnly_setReadMigrationEntitySources(() => Promise.resolve({ candidates: [candidate], issues: [] }));
    restores.push(__testOnly_resetReadMigrationEntitySources);
    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);
    __testOnly_setGetCache(() => ({ getRawDb: (() => ({})) as unknown as PCDCache['getRawDb'] }) as unknown as PCDCache);
    restores.push(__testOnly_resetGetCache);
    __testOnly_setWithRepoImportWriteContext(
      async (
        _context: {
          filenamePrefix: string;
          sequenceStart: number;
          maxOperations: number;
          lastSeenInRepoAt: string;
        },
        callback: () => Promise<unknown>
      ) => {
        return await callback();
      }
    );
    restores.push(__testOnly_resetWithRepoImportWriteContext);

    await assertRejects(
      () => importBaseOps(databaseId, '/tmp/unused'),
      Error,
      'Failed to import migration entity "quality-profiles/failing.yaml": mock import failure'
    );
    assertEquals(calls, ['quality-profiles/failing.yaml']);
  } finally {
    restoreAll();
  }
});

Deno.test('pcdManager: successful migration import still continues orchestration flow', async () => {
  const restores: Restore[] = [];
  const databaseId = 9011;
  const calls: string[] = [];

  function restoreAll(): void {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  }

  try {
    const { candidate } = buildTestCandidate('quality-profiles/success.yaml', { success: true }, calls);

    patch(
      pcdOpsQueries,
      'markBaseOrphaned',
      () => {
        return 0;
      },
      restores
    );
    __testOnly_setReadMigrationEntitySources(() => Promise.resolve({ candidates: [candidate], issues: [] }));
    restores.push(__testOnly_resetReadMigrationEntitySources);
    __testOnly_setCompile(() => Promise.resolve({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);
    __testOnly_setGetCache(() => ({ getRawDb: (() => ({})) as unknown as PCDCache['getRawDb'] }) as unknown as PCDCache);
    restores.push(__testOnly_resetGetCache);
    __testOnly_setWithRepoImportWriteContext(
      async (
        _context: {
          filenamePrefix: string;
          sequenceStart: number;
          maxOperations: number;
          lastSeenInRepoAt: string;
        },
        callback: () => Promise<unknown>
      ) => {
        return await callback();
      }
    );
    restores.push(__testOnly_resetWithRepoImportWriteContext);

    const imported = await importBaseOps(databaseId, '/tmp/unused');

    assertEquals(imported.imported, 1);
    assertEquals(imported.orphaned, 0);
    assertEquals(calls, ['quality-profiles/success.yaml']);
  } finally {
    restoreAll();
  }
});
