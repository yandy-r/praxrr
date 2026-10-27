import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
  trashGuideManager,
  TrashGuideSourceConflictError,
  TrashGuideSourceValidationError,
} from '$trashguide/manager.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { type TrashGuideEntityCache, trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashIdMappingsQueries } from '$db/queries/trashIdMappings.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import { config } from '$config';
import {
  asTrashGuideId,
  type TrashGuideCustomFormatEntity,
  type TrashGuideParsedEntity,
  type TrashGuideParseResult,
} from '$lib/server/trashguide/types.ts';
import type { TrashGuideTransformResult } from '$lib/server/trashguide/transformer.ts';

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function makeSource(overrides: Partial<TrashGuideSource> = {}): TrashGuideSource {
  return {
    id: 1,
    name: 'TRaSH',
    repository_url: 'https://github.com/x/y.git',
    branch: 'master',
    local_path: '/tmp/none',
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 0,
    auto_pull: false,
    enabled: true,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build an offline TRaSH source fixture. Passing the returned absolute path as
 * repositoryUrl makes clone() take its local-path COPY branch (no git, no network).
 * The four required metadata keys point at an empty `entities/` dir so discovery
 * finds zero files -> parse status 'success' with no entities.
 */
async function buildLocalFixture(): Promise<string> {
  const src = await Deno.makeTempDir();
  await Deno.mkdir(`${src}/entities`);
  await Deno.writeTextFile(
    `${src}/metadata.json`,
    JSON.stringify({
      json_paths: {
        radarr: {
          custom_formats: ['entities'],
          quality_profiles: ['entities'],
          qualities: ['entities'],
          naming: ['entities'],
        },
      },
    })
  );
  return src;
}

async function removeQuietly(path: string | null): Promise<void> {
  if (path === null) {
    return;
  }
  await Deno.remove(path, { recursive: true }).catch(() => undefined);
}

// -------------------------------------------------------------------------
// createSource rollback: clone succeeds, DB insert fails -> clone dir cleaned
// -------------------------------------------------------------------------

Deno.test({
  name: 'createSource removes cloned dir when DB insert fails',
  fn: async () => {
    const fixture = await buildLocalFixture();
    const restores: Restore[] = [];
    let capturedClonePath: string | null = null;

    patchTarget(
      trashGuideSourcesQueries,
      'nameExists',
      (() => false) as typeof trashGuideSourcesQueries.nameExists,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getAll', (() => []) as typeof trashGuideSourcesQueries.getAll, restores);
    patchTarget(
      trashGuideSourcesQueries,
      'delete',
      (() => {
        throw new Error('delete must not be called when insert throws before assignment');
      }) as typeof trashGuideSourcesQueries.delete,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'create',
      ((input) => {
        capturedClonePath = input.localPath;
        // Prove the clone genuinely copied the fixture before the insert fails.
        Deno.statSync(input.localPath);
        throw new Error('DB insert failed');
      }) as typeof trashGuideSourcesQueries.create,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      await assertRejects(
        () =>
          trashGuideManager.createSource({
            name: 'Radarr TRaSH',
            repositoryUrl: fixture,
            arrType: 'radarr',
          }),
        Error,
        'DB insert failed'
      );

      assertEquals(typeof capturedClonePath, 'string');
      await assertRejects(() => Deno.stat(capturedClonePath as string), Deno.errors.NotFound);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(capturedClonePath);
      await removeQuietly(fixture);
    }
  },
});

Deno.test({
  name: 'createSource maps DB unique-name violation to Conflict(name) and cleans clone',
  fn: async () => {
    const fixture = await buildLocalFixture();
    const restores: Restore[] = [];
    let capturedClonePath: string | null = null;

    patchTarget(
      trashGuideSourcesQueries,
      'nameExists',
      (() => false) as typeof trashGuideSourcesQueries.nameExists,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getAll', (() => []) as typeof trashGuideSourcesQueries.getAll, restores);
    patchTarget(
      trashGuideSourcesQueries,
      'create',
      ((input) => {
        capturedClonePath = input.localPath;
        throw new Error('UNIQUE constraint failed: trash_guide_sources.name');
      }) as typeof trashGuideSourcesQueries.create,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      const error = await assertRejects(
        () =>
          trashGuideManager.createSource({
            name: 'Radarr TRaSH',
            repositoryUrl: fixture,
            arrType: 'radarr',
          }),
        TrashGuideSourceConflictError
      );

      assertEquals(error.conflictField, 'name');
      assertStringIncludes(error.message, 'Radarr TRaSH');
      await assertRejects(() => Deno.stat(capturedClonePath as string), Deno.errors.NotFound);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(capturedClonePath);
      await removeQuietly(fixture);
    }
  },
});

// -------------------------------------------------------------------------
// createSource conflict + validation gates (hermetic; no clone reached)
// -------------------------------------------------------------------------

Deno.test('createSource duplicate name throws Conflict(name)', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideSourcesQueries,
    'nameExists',
    (() => true) as typeof trashGuideSourcesQueries.nameExists,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'create',
    (() => {
      throw new Error('create must not be called for a duplicate-name conflict');
    }) as typeof trashGuideSourcesQueries.create,
    restores
  );

  try {
    const error = await assertRejects(
      () =>
        trashGuideManager.createSource({
          name: 'Dup',
          repositoryUrl: 'https://github.com/x/y.git',
          arrType: 'radarr',
        }),
      TrashGuideSourceConflictError
    );

    assertEquals(error.conflictField, 'name');
    assertStringIncludes(error.message, 'Dup');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('createSource duplicate repo+branch+arrType throws Conflict(repository)', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideSourcesQueries,
    'nameExists',
    (() => false) as typeof trashGuideSourcesQueries.nameExists,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'getAll',
    (() => [
      makeSource({ id: 1, repository_url: 'https://github.com/x/y.git', branch: 'master', arr_type: 'radarr' }),
    ]) as typeof trashGuideSourcesQueries.getAll,
    restores
  );

  try {
    const error = await assertRejects(
      () =>
        trashGuideManager.createSource({
          name: 'New',
          repositoryUrl: 'https://github.com/x/y.git',
          branch: 'master',
          arrType: 'radarr',
        }),
      TrashGuideSourceConflictError
    );

    assertEquals(error.conflictField, 'repository');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test({
  name: 'createSource same repo+branch but different arrType is not a conflict (reaches insert)',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildLocalFixture();
    const restores: Restore[] = [];
    let capturedClonePath: string | null = null;

    patchTarget(
      trashGuideSourcesQueries,
      'nameExists',
      (() => false) as typeof trashGuideSourcesQueries.nameExists,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'getAll',
      (() => [
        makeSource({ id: 1, repository_url: fixture, branch: 'master', arr_type: 'sonarr' }),
      ]) as typeof trashGuideSourcesQueries.getAll,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'create',
      ((input) => {
        capturedClonePath = input.localPath;
        throw new Error('REACHED_INSERT');
      }) as typeof trashGuideSourcesQueries.create,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      await assertRejects(
        () =>
          trashGuideManager.createSource({
            name: 'New',
            repositoryUrl: fixture,
            branch: 'master',
            arrType: 'radarr',
          }),
        Error,
        'REACHED_INSERT'
      );
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(capturedClonePath);
      await removeQuietly(fixture);
    }
  },
});

Deno.test('createSource invalid arrType throws Validation(arr_type_invalid)', async () => {
  const error = await assertRejects(
    () =>
      trashGuideManager.createSource({
        name: 'x',
        repositoryUrl: 'https://github.com/x/y.git',
        arrType: 'plex',
      }),
    TrashGuideSourceValidationError
  );

  assertEquals(error.code, 'arr_type_invalid');
});

Deno.test(
  'createSource out-of-range syncStrategy throws Validation(sync_strategy_invalid) before linking',
  async () => {
    const restores: Restore[] = [];
    let linkCalls = 0;
    patchTarget(
      trashGuideManager,
      'link',
      (() => {
        linkCalls += 1;
        return Promise.reject(new Error('link should not be reached'));
      }) as typeof trashGuideManager.link,
      restores
    );

    try {
      for (const syncStrategy of [525_601, 200_000_000_000, -1, Number.NaN]) {
        const error = await assertRejects(
          () =>
            trashGuideManager.createSource({
              name: 'x',
              repositoryUrl: 'https://github.com/x/y.git',
              arrType: 'radarr',
              syncStrategy,
            }),
          TrashGuideSourceValidationError
        );
        assertEquals(error.code, 'sync_strategy_invalid');
        assertEquals(error.message, 'syncStrategy must be an integer between 0 and 525600');
      }
      assertEquals(linkCalls, 0);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  }
);

Deno.test(
  'updateSource out-of-range syncStrategy throws Validation(sync_strategy_invalid) without writing',
  async () => {
    const restores: Restore[] = [];
    let updateCalls = 0;
    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() => makeSource({ id: 9, arr_type: 'radarr' })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'update',
      (() => {
        updateCalls += 1;
        return true;
      }) as typeof trashGuideSourcesQueries.update,
      restores
    );

    try {
      for (const syncStrategy of [525_601, Number.NaN]) {
        const error = await assertRejects(
          () => trashGuideManager.updateSource(9, { syncStrategy }),
          TrashGuideSourceValidationError
        );
        assertEquals(error.code, 'sync_strategy_invalid');
      }
      assertEquals(updateCalls, 0);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  }
);

// -------------------------------------------------------------------------
// updateSource conflict + validation gates (hermetic; no clone reached)
// -------------------------------------------------------------------------

Deno.test('updateSource duplicate name throws Conflict(name)', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource({ id: 9, arr_type: 'radarr' })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'nameExists',
    ((name: string) => name === 'Taken') as typeof trashGuideSourcesQueries.nameExists,
    restores
  );

  try {
    const error = await assertRejects(
      () => trashGuideManager.updateSource(9, { name: 'Taken' }),
      TrashGuideSourceConflictError
    );

    assertEquals(error.conflictField, 'name');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('updateSource duplicate repo throws Conflict(repository)', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      makeSource({
        id: 9,
        repository_url: 'https://github.com/x/old.git',
        branch: 'master',
        arr_type: 'radarr',
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'nameExists',
    (() => false) as typeof trashGuideSourcesQueries.nameExists,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'getAll',
    (() => [
      makeSource({
        id: 99,
        repository_url: 'https://github.com/x/new.git',
        branch: 'master',
        arr_type: 'radarr',
      }),
    ]) as typeof trashGuideSourcesQueries.getAll,
    restores
  );

  try {
    const error = await assertRejects(
      () => trashGuideManager.updateSource(9, { repositoryUrl: 'https://github.com/x/new.git' }),
      TrashGuideSourceConflictError
    );

    assertEquals(error.conflictField, 'repository');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('updateSource arrType change throws Validation(arr_type_mismatch)', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource({ id: 9, arr_type: 'radarr' })) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const error = await assertRejects(
      () => trashGuideManager.updateSource(9, { arrType: 'sonarr' }),
      TrashGuideSourceValidationError
    );

    assertEquals(error.code, 'arr_type_mismatch');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('updateSource self-exclusion guard permits a no-op update on its own repository', async () => {
  const restores: Restore[] = [];
  const source = makeSource({
    id: 9,
    repository_url: 'https://github.com/x/y.git',
    branch: 'master',
    arr_type: 'radarr',
  });
  const nameExistsCalls: { name: string; excludeId?: number }[] = [];

  patchTarget(trashGuideSourcesQueries, 'getById', (() => source) as typeof trashGuideSourcesQueries.getById, restores);
  // getAll returns the SAME source (id 9); without the self-exclusion guard the
  // unchanged repo/branch/arrType would register as a repository conflict.
  patchTarget(trashGuideSourcesQueries, 'getAll', (() => [source]) as typeof trashGuideSourcesQueries.getAll, restores);
  patchTarget(
    trashGuideSourcesQueries,
    'nameExists',
    ((name: string, excludeId?: number) => {
      nameExistsCalls.push({ name, excludeId });
      return false;
    }) as typeof trashGuideSourcesQueries.nameExists,
    restores
  );
  patchTarget(trashGuideSourcesQueries, 'update', (() => true) as typeof trashGuideSourcesQueries.update, restores);
  patchTarget(
    trashGuideEntityCacheQueries,
    'getBySource',
    (() => []) as typeof trashGuideEntityCacheQueries.getBySource,
    restores
  );

  try {
    // scoreProfile is a non-repositoryUrl change, so no clone/fetch is reached.
    const response = await trashGuideManager.updateSource(9, { scoreProfile: 'x' });

    assertEquals(response.id, 9);
    assertEquals(nameExistsCalls.at(-1)?.excludeId, 9);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

// -------------------------------------------------------------------------
// updateSource URL change: new clone provisioned, old clone dir removed
// -------------------------------------------------------------------------

Deno.test({
  name: 'updateSource with changed repositoryUrl removes old clone dir',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildLocalFixture();
    const oldDir = await Deno.makeTempDir();
    const restores: Restore[] = [];
    let newClonePath: string | null = null;

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() =>
        makeSource({
          id: 7,
          local_path: oldDir,
          repository_url: 'https://github.com/x/old.git',
          arr_type: 'radarr',
        })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'nameExists',
      (() => false) as typeof trashGuideSourcesQueries.nameExists,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getAll', (() => []) as typeof trashGuideSourcesQueries.getAll, restores);
    patchTarget(
      trashGuideSourcesQueries,
      'updateSyncMetadata',
      (() => true) as typeof trashGuideSourcesQueries.updateSyncMetadata,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'update',
      ((_id, input) => {
        newClonePath = input.localPath ?? null;
        return true;
      }) as typeof trashGuideSourcesQueries.update,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'getBySource',
      (() => []) as typeof trashIdMappingsQueries.getBySource,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'replaceSourceMappings',
      (() => undefined) as unknown as typeof trashIdMappingsQueries.replaceSourceMappings,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'replaceSourceCache',
      (() => undefined) as typeof trashGuideEntityCacheQueries.replaceSourceCache,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'getBySource',
      (() => []) as typeof trashGuideEntityCacheQueries.getBySource,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      const response = await trashGuideManager.updateSource(7, { repositoryUrl: fixture });

      assertEquals(response.id, 7);
      if (newClonePath === null) {
        throw new Error('updateSource did not capture a new clone path');
      }
      // New clone exists on disk after the update succeeded.
      await Deno.stat(newClonePath);
      // Old clone dir was removed post-success.
      await assertRejects(() => Deno.stat(oldDir), Deno.errors.NotFound);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(newClonePath);
      await removeQuietly(oldDir);
      await removeQuietly(fixture);
    }
  },
});

Deno.test({
  name: 'updateSource removes new temp clone and keeps old dir when DB update fails',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildLocalFixture();
    const oldDir = await Deno.makeTempDir();
    const restores: Restore[] = [];
    let newClonePath: string | null = null;

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() =>
        makeSource({
          id: 7,
          local_path: oldDir,
          repository_url: 'https://github.com/x/old.git',
          arr_type: 'radarr',
        })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'nameExists',
      (() => false) as typeof trashGuideSourcesQueries.nameExists,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getAll', (() => []) as typeof trashGuideSourcesQueries.getAll, restores);
    patchTarget(
      trashGuideSourcesQueries,
      'updateSyncMetadata',
      (() => true) as typeof trashGuideSourcesQueries.updateSyncMetadata,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'update',
      ((_id, input) => {
        newClonePath = input.localPath ?? null;
        throw new Error('update failed');
      }) as typeof trashGuideSourcesQueries.update,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'getBySource',
      (() => []) as typeof trashIdMappingsQueries.getBySource,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'replaceSourceMappings',
      (() => undefined) as unknown as typeof trashIdMappingsQueries.replaceSourceMappings,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'replaceSourceCache',
      (() => undefined) as typeof trashGuideEntityCacheQueries.replaceSourceCache,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      await assertRejects(() => trashGuideManager.updateSource(7, { repositoryUrl: fixture }), Error, 'update failed');

      // New temp clone was cleaned up by the failure catch block.
      await assertRejects(() => Deno.stat(newClonePath as string), Deno.errors.NotFound);
      // Old clone dir is preserved when the update fails.
      await Deno.stat(oldDir);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(newClonePath);
      await removeQuietly(oldDir);
      await removeQuietly(fixture);
    }
  },
});

// -------------------------------------------------------------------------
// sync() error logging: the three previously-silent catch blocks now log
// -------------------------------------------------------------------------

Deno.test({
  name: 'sync logs pre-sync warn and main error for a non-git local_path',
  sanitizeResources: false,
  fn: async () => {
    const nonGitDir = await Deno.makeTempDir();
    const restores: Restore[] = [];
    const warns: { message: string; meta: unknown }[] = [];
    const errors: { message: string; meta: unknown }[] = [];

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() =>
        makeSource({
          id: 3,
          local_path: nonGitDir,
          repository_url: 'https://github.com/x/y.git',
          branch: 'master',
          arr_type: 'radarr',
        })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      logger,
      'warn',
      ((message: string, options?: Parameters<typeof logger.warn>[1]) => {
        warns.push({ message, meta: options?.meta });
        return Promise.resolve();
      }) as typeof logger.warn,
      restores
    );
    patchTarget(
      logger,
      'error',
      ((message: string, options?: Parameters<typeof logger.error>[1]) => {
        errors.push({ message, meta: options?.meta });
        return Promise.resolve();
      }) as typeof logger.error,
      restores
    );

    try {
      const result = await trashGuideManager.sync(3);

      assertEquals(result.success, false);
      assertEquals(result.parseStatus, 'failed');
      assertEquals(result.failureKind, 'run');

      const preSyncWarn = warns.find((entry) => entry.message === 'Failed TRaSH source pre-sync update check');
      assertEquals(preSyncWarn !== undefined, true);

      const syncError = errors.find((entry) => entry.message === 'TRaSH source sync failed');
      assertEquals(syncError !== undefined, true);
      const errorMeta = syncError?.meta as { error?: string } | undefined;
      assertStringIncludes(String(errorMeta?.error), 'not a git repository');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(nonGitDir);
    }
  },
});

Deno.test({
  name: 'sync logs commit-hash warn on a successful sync over a local fixture',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildLocalFixture();
    const tempRoot = await Deno.makeTempDir();
    const cloneTarget = `${tempRoot}/clone`;
    const restores: Restore[] = [];
    const warns: string[] = [];

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() =>
        makeSource({
          id: 4,
          local_path: cloneTarget,
          repository_url: fixture,
          branch: 'master',
          arr_type: 'radarr',
        })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'updateSyncMetadata',
      (() => true) as typeof trashGuideSourcesQueries.updateSyncMetadata,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'getBySource',
      (() => []) as typeof trashIdMappingsQueries.getBySource,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'replaceSourceMappings',
      (() => undefined) as unknown as typeof trashIdMappingsQueries.replaceSourceMappings,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'replaceSourceCache',
      (() => undefined) as typeof trashGuideEntityCacheQueries.replaceSourceCache,
      restores
    );
    patchTarget(arrInstancesQueries, 'getByType', (() => []) as typeof arrInstancesQueries.getByType, restores);
    patchTarget(
      trashGuideSyncQueries,
      'setStatusPendingBySource',
      (() => 0) as typeof trashGuideSyncQueries.setStatusPendingBySource,
      restores
    );
    patchTarget(
      logger,
      'warn',
      ((message: string) => {
        warns.push(message);
        return Promise.resolve();
      }) as typeof logger.warn,
      restores
    );

    try {
      const result = await trashGuideManager.sync(4);

      assertEquals(result.success, true);
      assertEquals(result.parseStatus, 'success');
      assertEquals(result.parsedFiles, 0);

      const commitWarn = warns.find((message) => message === 'Failed to retrieve TRaSH source commit hash');
      assertEquals(commitWarn !== undefined, true);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(tempRoot);
      await removeQuietly(fixture);
    }
  },
});

// -------------------------------------------------------------------------
// YAN-447: partial/failed parse must not wipe cached entities
// -------------------------------------------------------------------------

interface PartialFixture {
  fixturePath: string;
  okFileRel: string;
  badFileRel: string;
}

/**
 * Local fixture with one valid custom_format JSON and one malformed JSON in the
 * same discovery dir -> parse status 'partial'.
 */
async function buildPartialFixture(): Promise<PartialFixture> {
  const src = await Deno.makeTempDir();
  // Distinct dirs per metadata key: each file is discovered exactly once.
  for (const dir of ['cf', 'qp', 'qs', 'nm']) {
    await Deno.mkdir(`${src}/${dir}`);
  }
  await Deno.writeTextFile(
    `${src}/metadata.json`,
    JSON.stringify({
      json_paths: {
        radarr: {
          custom_formats: ['cf'],
          quality_profiles: ['qp'],
          qualities: ['qs'],
          naming: ['nm'],
        },
      },
    })
  );
  await Deno.writeTextFile(
    `${src}/cf/ok.json`,
    JSON.stringify({
      trash_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'OK Format',
      includeCustomFormatWhenRenaming: false,
      specifications: [],
    })
  );
  await Deno.writeTextFile(`${src}/cf/bad.json`, '{ this is not json');
  return { fixturePath: src, okFileRel: 'cf/ok.json', badFileRel: 'cf/bad.json' };
}

/** Local fixture where every discovered file fails to parse -> status 'failed'. */
async function buildFailedFixture(): Promise<string> {
  const src = await Deno.makeTempDir();
  for (const dir of ['cf', 'qp', 'qs', 'nm']) {
    await Deno.mkdir(`${src}/${dir}`);
  }
  await Deno.writeTextFile(
    `${src}/metadata.json`,
    JSON.stringify({
      json_paths: {
        radarr: {
          custom_formats: ['cf'],
          quality_profiles: ['qp'],
          qualities: ['qs'],
          naming: ['nm'],
        },
      },
    })
  );
  await Deno.writeTextFile(`${src}/cf/broken.json`, '{ not json at all');
  return src;
}

/** Build a custom_format entity as it would appear in the cache row json_data. */
function makeCfEntity(overrides: { trash_id: string; file_path: string; name: string }): TrashGuideCustomFormatEntity {
  return {
    entity_type: 'custom_format',
    arr_type: 'radarr',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {},
    specifications: [],
    ...overrides,
    trash_id: asTrashGuideId(overrides.trash_id),
  };
}

function makeCacheRow(
  sourceId: number,
  entity: TrashGuideParsedEntity,
  filePath: string,
  id: number
): TrashGuideEntityCache {
  return {
    id,
    sourceId,
    trashId: entity.trash_id,
    entityType: entity.entity_type,
    name: entity.name,
    jsonData: JSON.stringify(entity),
    filePath,
    contentHash: 'hash',
    fetchedAt: '2026-01-01T00:00:00.000Z',
  };
}

Deno.test({
  name: 'sync with failed parse performs no writes and returns success:false',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildFailedFixture();
    const tempRoot = await Deno.makeTempDir();
    const cloneTarget = `${tempRoot}/clone`;
    const restores: Restore[] = [];
    const replacedCaches: unknown[] = [];
    const replacedMappings: unknown[] = [];
    const syncMetadataUpdates: unknown[] = [];
    const pendingCalls: number[] = [];
    const arrInstanceLookups: unknown[] = [];
    const errors: { message: string; meta: unknown }[] = [];

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() =>
        makeSource({
          id: 10,
          local_path: cloneTarget,
          repository_url: fixture,
          arr_type: 'radarr',
        })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'updateSyncMetadata',
      ((id: number, input: unknown) => {
        syncMetadataUpdates.push({ id, input });
        return true;
      }) as unknown as typeof trashGuideSourcesQueries.updateSyncMetadata,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'getBySource',
      (() => []) as typeof trashIdMappingsQueries.getBySource,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'replaceSourceMappings',
      ((...args: unknown[]) => {
        replacedMappings.push(args);
      }) as unknown as typeof trashIdMappingsQueries.replaceSourceMappings,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'getBySource',
      (() => []) as typeof trashGuideEntityCacheQueries.getBySource,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'replaceSourceCache',
      ((...args: unknown[]) => {
        replacedCaches.push(args);
      }) as unknown as typeof trashGuideEntityCacheQueries.replaceSourceCache,
      restores
    );
    patchTarget(
      trashGuideSyncQueries,
      'setStatusPendingBySource',
      ((id: number) => {
        pendingCalls.push(id);
        return 1;
      }) as typeof trashGuideSyncQueries.setStatusPendingBySource,
      restores
    );
    patchTarget(
      arrInstancesQueries,
      'getByType',
      ((...args: unknown[]) => {
        arrInstanceLookups.push(args);
        return [];
      }) as unknown as typeof arrInstancesQueries.getByType,
      restores
    );
    patchTarget(
      logger,
      'error',
      ((message: string, options?: { meta?: unknown }) => {
        errors.push({ message, meta: options?.meta });
        return Promise.resolve();
      }) as typeof logger.error,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      const result = await trashGuideManager.sync(10);

      assertEquals(result.success, false);
      assertEquals(result.parseStatus, 'failed');
      assertEquals(result.parsedFiles, 0);
      assertEquals(result.failedFiles, 1);
      assertEquals(result.activeOperations, 0);
      assertEquals(result.removedEntities, 0);
      assertEquals(result.renamedEntities, 0);
      assertStringIncludes(String(result.error), 'TRaSH parse failed for every discovered file (1)');
      assertEquals(result.failureKind, 'parse');

      // No persistence at all: cache, mappings and sync metadata untouched.
      assertEquals(replacedCaches.length, 0);
      assertEquals(replacedMappings.length, 0);
      assertEquals(syncMetadataUpdates.length, 0);
      // No on_pull fanout: triggerPullSync would mark sync rows pending and look up Arr instances.
      assertEquals(pendingCalls.length, 0);
      assertEquals(arrInstanceLookups.length, 0);
      // Failure is logged without raw file contents.
      assertEquals(
        errors.some((entry) => entry.message === 'TRaSH source parse failed; no entities persisted'),
        true
      );
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(tempRoot);
      await removeQuietly(fixture);
    }
  },
});

Deno.test({
  name: 'sync with partial parse retains failed-file entities and excludes them from removedEntities',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildPartialFixture();
    const tempRoot = await Deno.makeTempDir();
    const cloneTarget = `${tempRoot}/clone`;
    const restores: Restore[] = [];

    // Prior cache: retained row (bad file), replaced row (now ok.json), removed row (file gone upstream).
    const retainedEntity = makeCfEntity({
      trash_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      file_path: fixture.badFileRel,
      name: 'Retained Format',
    });
    const replacedEntity = makeCfEntity({
      trash_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      file_path: fixture.okFileRel,
      name: 'Old Name',
    });
    const removedEntity = makeCfEntity({
      trash_id: 'cccccccccccccccccccccccccccccccc',
      file_path: 'cf/gone.json',
      name: 'Gone Format',
    });

    const priorCacheRows = [
      makeCacheRow(11, retainedEntity, fixture.badFileRel, 1),
      makeCacheRow(11, replacedEntity, fixture.okFileRel, 2),
      makeCacheRow(11, removedEntity, 'cf/gone.json', 3),
    ];

    const priorMappings = [
      {
        sourceId: 11,
        arrType: 'radarr',
        entityType: 'custom_format',
        trashId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        entityName: 'Old Name',
      },
      {
        sourceId: 11,
        arrType: 'radarr',
        entityType: 'custom_format',
        trashId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        entityName: 'Retained Format',
      },
      {
        sourceId: 11,
        arrType: 'radarr',
        entityType: 'custom_format',
        trashId: 'cccccccccccccccccccccccccccccccc',
        entityName: 'Gone Format',
      },
    ];

    const writtenCacheRows: { trashId: string; name: string }[] = [];
    const writtenMappings: { trashId: string; entityName: string }[] = [];
    const warns: { message: string; meta: unknown }[] = [];

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() =>
        makeSource({
          id: 11,
          local_path: cloneTarget,
          repository_url: fixture.fixturePath,
          arr_type: 'radarr',
        })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'updateSyncMetadata',
      (() => true) as typeof trashGuideSourcesQueries.updateSyncMetadata,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'getBySource',
      (() => priorMappings) as unknown as typeof trashIdMappingsQueries.getBySource,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'replaceSourceMappings',
      ((_sourceId: number, _arrType: string, rows: { trashId: string; entityName: string }[]) => {
        writtenMappings.push(...rows);
      }) as unknown as typeof trashIdMappingsQueries.replaceSourceMappings,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'getBySource',
      (() => priorCacheRows) as unknown as typeof trashGuideEntityCacheQueries.getBySource,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'replaceSourceCache',
      ((_sourceId: number, rows: { trashId: string; name: string }[]) => {
        writtenCacheRows.push(...rows);
      }) as unknown as typeof trashGuideEntityCacheQueries.replaceSourceCache,
      restores
    );
    patchTarget(arrInstancesQueries, 'getByType', (() => []) as typeof arrInstancesQueries.getByType, restores);
    patchTarget(
      trashGuideSyncQueries,
      'setStatusPendingBySource',
      (() => 0) as typeof trashGuideSyncQueries.setStatusPendingBySource,
      restores
    );
    patchTarget(
      logger,
      'warn',
      ((message: string, options?: { meta?: unknown }) => {
        warns.push({ message, meta: options?.meta });
        return Promise.resolve();
      }) as typeof logger.warn,
      restores
    );
    patchTarget(logger, 'error', (() => Promise.resolve()) as typeof logger.error, restores);

    try {
      const result = await trashGuideManager.sync(11);

      assertEquals(result.success, true);
      assertEquals(result.parseStatus, 'partial');
      assertEquals(result.parsedFiles, 1);
      assertEquals(result.failedFiles, 1);

      // Cache rows = parsed (ok.json) + retained (bad.json); the upstream-deleted row is dropped.
      assertEquals(writtenCacheRows.length > 0, true, 'replaceSourceCache was not called');
      const cacheByTrashId = new Map(writtenCacheRows.map((row) => [row.trashId, row.name]));
      assertEquals(cacheByTrashId.size, 2);
      assertEquals(cacheByTrashId.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'OK Format');
      assertEquals(cacheByTrashId.get('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), 'Retained Format');
      assertEquals(cacheByTrashId.has('cccccccccccccccccccccccccccccccc'), false);

      // Mapping writes mirror the same merged entity set.
      assertEquals(writtenMappings.length > 0, true, 'replaceSourceMappings was not called');
      const mappingTrashIds = writtenMappings.map((row) => row.trashId).sort();
      assertEquals(mappingTrashIds, ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);

      // Retained entity is not reported removed; the truly upstream-deleted one still is.
      assertEquals(result.removedEntities, 1);
      // The ok.json entity was renamed from 'Old Name' to 'OK Format'.
      assertEquals(result.renamedEntities, 1);

      const retentionWarn = warns.find(
        (entry) => entry.message === 'TRaSH source parse partial; retained previous entities for failed files'
      );
      assertEquals(retentionWarn !== undefined, true);
      const meta = retentionWarn?.meta as
        { sourceId?: number; failedFiles?: number; retainedEntities?: number } | undefined;
      assertEquals(meta?.sourceId, 11);
      assertEquals(meta?.failedFiles, 1);
      assertEquals(meta?.retainedEntities, 1);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(tempRoot);
      await removeQuietly(fixture.fixturePath);
    }
  },
});

// -------------------------------------------------------------------------
// YAN-447 review follow-ups
// -------------------------------------------------------------------------

const AAAA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BBBB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CCCC = 'cccccccccccccccccccccccccccccccc';

async function listCloneDir(): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(`${config.paths.data}/trashguide`)) {
      names.push(entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  return names.sort();
}

function priorMapping(trashId: string, entityName: string) {
  return { sourceId: 12, arrType: 'radarr', entityType: 'custom_format', trashId, entityName };
}

interface PersistHarness {
  persist(
    source: TrashGuideSource,
    parsed: TrashGuideParseResult,
    options: { retainPrior: boolean }
  ): Promise<TrashGuideTransformResult | null>;
}

function partialParseResult(): TrashGuideParseResult {
  const ok = makeCfEntity({ trash_id: AAAA, file_path: 'cf/ok.json', name: 'OK Format' });
  return {
    arr_type: 'radarr',
    status: 'partial',
    entities: { custom_formats: [ok], custom_format_groups: [], quality_profiles: [], quality_sizes: [], naming: [] },
    ordered_entities: [ok],
    issues: [
      {
        code: 'json_parse_error',
        retryable: false,
        entity_type: 'custom_format',
        file_path: 'cf/bad.json',
        message: 'Malformed JSON',
      },
    ],
    parsed_files: 1,
    failed_files: 1,
  };
}

async function runPersist(
  retainPrior: boolean,
  priorRows: TrashGuideEntityCache[]
): Promise<{
  result: TrashGuideTransformResult | null;
  cacheTrashIds: string[];
  warns: { message: string; meta: unknown }[];
}> {
  const restores: Restore[] = [];
  const cacheTrashIds: string[] = [];
  const warns: { message: string; meta: unknown }[] = [];
  patchTarget(
    trashIdMappingsQueries,
    'getBySource',
    (() => [
      priorMapping(AAAA, 'OK Format'),
      priorMapping(BBBB, 'Retained Format'),
      priorMapping(CCCC, 'Gone Format'),
    ]) as unknown as typeof trashIdMappingsQueries.getBySource,
    restores
  );
  patchTarget(
    trashIdMappingsQueries,
    'replaceSourceMappings',
    (() => undefined) as unknown as typeof trashIdMappingsQueries.replaceSourceMappings,
    restores
  );
  patchTarget(
    trashGuideEntityCacheQueries,
    'getBySource',
    (() => priorRows) as typeof trashGuideEntityCacheQueries.getBySource,
    restores
  );
  patchTarget(
    trashGuideEntityCacheQueries,
    'replaceSourceCache',
    ((_id: number, rows: { trashId: string }[]) => {
      cacheTrashIds.push(...rows.map((row) => row.trashId));
    }) as unknown as typeof trashGuideEntityCacheQueries.replaceSourceCache,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'updateSyncMetadata',
    (() => true) as typeof trashGuideSourcesQueries.updateSyncMetadata,
    restores
  );
  patchTarget(
    logger,
    'warn',
    ((message: string, options?: { meta?: unknown }) => {
      warns.push({ message, meta: options?.meta });
      return Promise.resolve();
    }) as typeof logger.warn,
    restores
  );
  try {
    const harness = trashGuideManager as unknown as {
      persistSourceSyncData: PersistHarness['persist'];
    };
    const result = await harness.persistSourceSyncData(makeSource({ id: 12 }), partialParseResult(), { retainPrior });
    return { result, cacheTrashIds: cacheTrashIds.sort(), warns };
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
}

Deno.test(
  'persistSourceSyncData partial + retainPrior keeps failed-file rows and reports exact removed identities',
  async () => {
    const rows = [
      makeCacheRow(
        12,
        makeCfEntity({ trash_id: BBBB, file_path: 'cf/bad.json', name: 'Retained Format' }),
        'cf/bad.json',
        1
      ),
      makeCacheRow(
        12,
        makeCfEntity({ trash_id: CCCC, file_path: 'cf/gone.json', name: 'Gone Format' }),
        'cf/gone.json',
        2
      ),
    ];
    const { result, cacheTrashIds, warns } = await runPersist(true, rows);

    assertEquals(cacheTrashIds, [AAAA, BBBB]);
    assertEquals(
      result?.removedEntities.map((entry) => `${entry.identity.entityType}:${entry.identity.trashId}`),
      [`custom_format:${CCCC}`]
    );
    const retainedWarn = warns.find(
      (entry) => entry.message === 'TRaSH source parse partial; retained previous entities for failed files'
    );
    assertEquals(retainedWarn?.meta, { sourceId: 12, failedFiles: 1, retainedEntities: 1 });
  }
);

Deno.test('persistSourceSyncData partial + retainPrior=false is a plain replace (no retention)', async () => {
  const rows = [
    makeCacheRow(
      12,
      makeCfEntity({ trash_id: BBBB, file_path: 'cf/bad.json', name: 'Retained Format' }),
      'cf/bad.json',
      1
    ),
  ];
  const { result, cacheTrashIds, warns } = await runPersist(false, rows);

  assertEquals(cacheTrashIds, [AAAA]);
  assertEquals(result?.removedEntities.map((entry) => entry.identity.trashId).sort(), [BBBB, CCCC]);
  const retainedWarn = warns.find(
    (entry) => entry.message === 'TRaSH source parse partial; retained previous entities for failed files'
  );
  assertEquals((retainedWarn?.meta as { retainedEntities?: number }).retainedEntities, 0);
});

Deno.test('persistSourceSyncData does not retain an identity that re-parsed from another file', async () => {
  // AAAA used to live in the (now failing) bad.json but is freshly parsed from ok.json.
  const rows = [
    makeCacheRow(12, makeCfEntity({ trash_id: AAAA, file_path: 'cf/bad.json', name: 'Stale Name' }), 'cf/bad.json', 1),
  ];
  const { result, cacheTrashIds } = await runPersist(true, rows);

  assertEquals(cacheTrashIds, [AAAA]);
  assertEquals(result?.removedEntities.map((entry) => entry.identity.trashId).sort(), [BBBB, CCCC]);
});

Deno.test('persistSourceSyncData drops undecodable or identity-mismatched cache rows with a warning', async () => {
  const good = makeCfEntity({ trash_id: BBBB, file_path: 'cf/bad.json', name: 'Retained Format' });
  const garbage = { ...makeCacheRow(12, good, 'cf/bad.json', 1), jsonData: '{not json' };
  const idMismatch = {
    ...makeCacheRow(12, good, 'cf/bad.json', 2),
    jsonData: JSON.stringify({ ...good, trash_id: CCCC }),
  };
  const arrMismatch = {
    ...makeCacheRow(12, good, 'cf/bad.json', 3),
    trashId: asTrashGuideId(CCCC).toString(),
    jsonData: JSON.stringify({ ...good, trash_id: CCCC, arr_type: 'sonarr' }),
  };
  const pathMismatch = {
    ...makeCacheRow(12, good, 'cf/bad.json', 4),
    trashId: 'dddddddddddddddddddddddddddddddd',
    jsonData: JSON.stringify({ ...good, trash_id: 'dddddddddddddddddddddddddddddddd', file_path: 'cf/elsewhere.json' }),
  };
  const { cacheTrashIds, warns } = await runPersist(true, [garbage, idMismatch, arrMismatch, pathMismatch]);

  assertEquals(cacheTrashIds, [AAAA]);
  const decodeWarn = warns.find(
    (entry) => entry.message === 'TRaSH source parse partial; failed to decode retained cache entities'
  );
  assertEquals((decodeWarn?.meta as { undecodableRows?: number }).undecodableRows, 4);
});

Deno.test({
  name: 'link rejects a fully failed parse: no row created, clone removed',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildFailedFixture();
    const restores: Restore[] = [];
    let createCalls = 0;
    const before = await listCloneDir();

    patchTarget(
      trashGuideSourcesQueries,
      'create',
      (() => {
        createCalls += 1;
        return 1;
      }) as typeof trashGuideSourcesQueries.create,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      const error = await assertRejects(
        () => trashGuideManager.link({ name: 'Broken', repositoryUrl: fixture, arrType: 'radarr' }),
        TrashGuideSourceValidationError
      );
      assertEquals(error.code, 'parse_failed');
      assertEquals(createCalls, 0);
      assertEquals(await listCloneDir(), before);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(fixture);
    }
  },
});

Deno.test({
  name: 'updateSource re-clone rejects a fully failed parse and leaves the row and old clone untouched',
  sanitizeResources: false,
  fn: async () => {
    const fixture = await buildFailedFixture();
    const oldDir = await Deno.makeTempDir();
    const restores: Restore[] = [];
    let updateCalls = 0;
    let cacheWrites = 0;
    let mappingWrites = 0;
    const before = await listCloneDir();

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() =>
        makeSource({
          id: 7,
          local_path: oldDir,
          repository_url: 'https://github.com/x/old.git',
          arr_type: 'radarr',
        })) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'nameExists',
      (() => false) as typeof trashGuideSourcesQueries.nameExists,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getAll', (() => []) as typeof trashGuideSourcesQueries.getAll, restores);
    patchTarget(
      trashGuideSourcesQueries,
      'update',
      (() => {
        updateCalls += 1;
        return true;
      }) as typeof trashGuideSourcesQueries.update,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'replaceSourceCache',
      (() => {
        cacheWrites += 1;
      }) as typeof trashGuideEntityCacheQueries.replaceSourceCache,
      restores
    );
    patchTarget(
      trashIdMappingsQueries,
      'replaceSourceMappings',
      (() => {
        mappingWrites += 1;
      }) as unknown as typeof trashIdMappingsQueries.replaceSourceMappings,
      restores
    );
    patchTarget(logger, 'warn', (() => Promise.resolve()) as typeof logger.warn, restores);

    try {
      const error = await assertRejects(
        () => trashGuideManager.updateSource(7, { repositoryUrl: fixture }),
        TrashGuideSourceValidationError
      );
      assertEquals(error.code, 'parse_failed');
      assertEquals(updateCalls, 0);
      assertEquals(cacheWrites, 0);
      assertEquals(mappingWrites, 0);
      // Old clone preserved, temp clone cleaned up.
      await Deno.stat(oldDir);
      assertEquals(await listCloneDir(), before);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(oldDir);
      await removeQuietly(fixture);
    }
  },
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const output = await new Deno.Command('git', {
    args: ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (!output.success) {
    throw new Error(`git ${args.join(' ')} failed: ${new TextDecoder().decode(output.stderr)}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

Deno.test({
  name: 'sync with failed parse resets a git clone back to last_commit_hash',
  sanitizeResources: false,
  fn: async () => {
    const root = await Deno.makeTempDir();
    const origin = `${root}/origin`;
    const clonePath = `${root}/clone`;
    const restores: Restore[] = [];
    const warns: string[] = [];
    // Hermetic git: a developer's global config (e.g. fetch.prune) must not alter the fetch/reset flow.
    const previousGlobalConfig = Deno.env.get('GIT_CONFIG_GLOBAL');
    Deno.env.set('GIT_CONFIG_GLOBAL', '/dev/null');

    try {
      await Deno.mkdir(`${origin}/cf`, { recursive: true });
      await Deno.writeTextFile(
        `${origin}/metadata.json`,
        JSON.stringify({
          json_paths: {
            radarr: { custom_formats: ['cf'], quality_profiles: ['qp'], qualities: ['qs'], naming: ['nm'] },
          },
        })
      );
      for (const dir of ['qp', 'qs', 'nm']) {
        await Deno.mkdir(`${origin}/${dir}`);
        await Deno.writeTextFile(`${origin}/${dir}/.keep`, '');
      }
      await Deno.writeTextFile(`${origin}/cf/one.json`, '{ broken one');
      await git(origin, 'init', '-q', '-b', 'master');
      await git(origin, 'add', '-A');
      await git(origin, 'commit', '-q', '-m', 'c1');
      const firstCommit = await git(origin, 'rev-parse', 'HEAD');
      await git(root, 'clone', '-q', origin, clonePath);

      await Deno.writeTextFile(`${origin}/cf/two.json`, '{ broken two');
      await git(origin, 'add', '-A');
      await git(origin, 'commit', '-q', '-m', 'c2');
      const secondCommit = await git(origin, 'rev-parse', 'HEAD');
      assertEquals(firstCommit === secondCommit, false);

      patchTarget(
        trashGuideSourcesQueries,
        'getById',
        (() =>
          makeSource({
            id: 13,
            local_path: clonePath,
            repository_url: 'https://example.invalid/x.git',
            branch: 'master',
            last_commit_hash: firstCommit,
            arr_type: 'radarr',
          })) as typeof trashGuideSourcesQueries.getById,
        restores
      );
      patchTarget(
        logger,
        'warn',
        ((message: string) => {
          warns.push(message);
          return Promise.resolve();
        }) as typeof logger.warn,
        restores
      );
      patchTarget(logger, 'error', (() => Promise.resolve()) as typeof logger.error, restores);

      const result = await trashGuideManager.sync(13);

      assertEquals(result.success, false);
      assertEquals(result.failureKind, 'parse');
      // Clone is back on the last synced commit, so the next update check still sees commitsBehind > 0.
      assertEquals(await git(clonePath, 'rev-parse', 'HEAD'), firstCommit);
      assertEquals(await git(clonePath, 'rev-list', '--count', 'HEAD..origin/master'), '1');
      assertEquals(warns.includes('Failed to reset TRaSH clone to last synced commit after parse failure'), false);
    } finally {
      if (previousGlobalConfig === undefined) {
        Deno.env.delete('GIT_CONFIG_GLOBAL');
      } else {
        Deno.env.set('GIT_CONFIG_GLOBAL', previousGlobalConfig);
      }
      for (const restore of restores.reverse()) {
        restore();
      }
      await removeQuietly(root);
    }
  },
});
