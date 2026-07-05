import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
  trashGuideManager,
  TrashGuideSourceConflictError,
  TrashGuideSourceValidationError,
} from '$trashguide/manager.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashIdMappingsQueries } from '$db/queries/trashIdMappings.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';

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
