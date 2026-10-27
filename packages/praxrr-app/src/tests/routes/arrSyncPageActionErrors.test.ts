// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assertEquals } from '@std/assert';
import type { Action } from '@sveltejs/kit';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import {
  trashGuideSyncQueries,
  TrashGuideSyncScopeError,
  TrashGuideSyncValidationError,
} from '$db/queries/trashGuideSync.ts';
import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { logger } from '$logger/logger.ts';
import { actions } from '../../routes/arr/[id]/sync/+page.server.ts';

type ActionEvent = Parameters<Action>[0];
type ActionFailure = { status: number; data?: { error?: string } };

const SECRET = 'apikey=sk_live_SECRET123';
const RAW_DB_ERROR = 'HTTP 500: Internal Server Error | ' + SECRET;
const SYNC_ENQUEUE_FAILED = 'Failed to queue the sync. Check the server logs for details.';
const SAVE_METADATA_PROFILES_FAILED =
  'Failed to save metadata profiles sync config. Check the server logs for details.';
const TRASH_GUIDE_ACTION_FAILED = 'TRaSH source sync request failed. Check the server logs for details.';

/** Real scratch SQLite DB per test with the full migration chain (mirrors arrSyncLiveStatus.test.ts). */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/arr-sync-page-action-errors-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function createInstance(type: 'radarr' | 'sonarr' | 'lidarr' = 'radarr'): number {
  return arrInstancesQueries.create({
    name: `${type} ${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

function withNoopLogger(): () => void {
  const originalWarn = logger.warn;
  const originalInfo = logger.info;
  const originalError = logger.error;
  const originalDebug = logger.debug;
  const originalErrorWithTrace = logger.errorWithTrace;

  logger.warn = async () => {};
  logger.info = async () => {};
  logger.error = async () => {};
  logger.debug = async () => {};
  logger.errorWithTrace = async () => {};

  return () => {
    logger.warn = originalWarn;
    logger.info = originalInfo;
    logger.error = originalError;
    logger.debug = originalDebug;
    logger.errorWithTrace = originalErrorWithTrace;
  };
}

/** Swap one query-module method; returns a restore function. */
function replace<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): () => void {
  const original = target[key];
  target[key] = value;
  return () => {
    target[key] = original;
  };
}

function paramsEvent(id: string): ActionEvent {
  return { params: { id } } as never;
}

function formEvent(id: string, fill: (fd: FormData) => void): ActionEvent {
  const fd = new FormData();
  fill(fd);
  return {
    params: { id },
    request: new Request(`http://localhost/arr/${id}/sync`, { method: 'POST', body: fd }),
  } as never;
}

function assertSanitizedFailure(result: ActionFailure, expectedError: string): void {
  assertEquals(result.status, 500);
  assertEquals(result.data?.error, expectedError);
  assertEquals(JSON.stringify(result).includes('SECRET123'), false);
  assertEquals(JSON.stringify(result).includes('HTTP 500:'), false);
}

migratedTest('sync section actions: 5xx returns fixed user-safe message without raw error text', async () => {
  const radarrId = createInstance('radarr');
  const lidarrId = createInstance('lidarr');

  const restoreLogger = withNoopLogger();
  try {
    const restoreDelay = replace(arrSyncQueries, 'setDelayProfilesStatusPending', () => {
      throw new Error(RAW_DB_ERROR);
    });
    try {
      const result = (await actions.syncDelayProfiles(paramsEvent(String(radarrId)))) as ActionFailure;
      assertSanitizedFailure(result, SYNC_ENQUEUE_FAILED);
    } finally {
      restoreDelay();
    }

    const restoreQuality = replace(arrSyncQueries, 'setQualityProfilesStatusPending', () => {
      throw new Error(RAW_DB_ERROR);
    });
    try {
      const result = (await actions.syncQualityProfiles(paramsEvent(String(radarrId)))) as ActionFailure;
      assertSanitizedFailure(result, SYNC_ENQUEUE_FAILED);
    } finally {
      restoreQuality();
    }

    const restoreMedia = replace(arrSyncQueries, 'setMediaManagementStatusPending', () => {
      throw new Error(RAW_DB_ERROR);
    });
    try {
      const result = (await actions.syncMediaManagement(paramsEvent(String(radarrId)))) as ActionFailure;
      assertSanitizedFailure(result, SYNC_ENQUEUE_FAILED);
    } finally {
      restoreMedia();
    }

    const restoreMetadata = replace(arrSyncQueries, 'setMetadataProfilesStatusPending', () => {
      throw new Error(RAW_DB_ERROR);
    });
    try {
      const result = (await actions.syncMetadataProfiles(paramsEvent(String(lidarrId)))) as ActionFailure;
      assertSanitizedFailure(result, SYNC_ENQUEUE_FAILED);
    } finally {
      restoreMetadata();
    }
  } finally {
    restoreLogger();
  }
});

migratedTest('sync section action 5xx logs the raw error server-side via the logger', async () => {
  const instanceId = createInstance('radarr');

  const loggedMeta: unknown[] = [];
  const originalError = logger.error;
  logger.error = async (_message: string, options?: unknown) => {
    loggedMeta.push((options as { meta?: unknown } | undefined)?.meta);
  };

  const restorePending = replace(arrSyncQueries, 'setDelayProfilesStatusPending', () => {
    throw new Error(RAW_DB_ERROR);
  });
  try {
    const result = (await actions.syncDelayProfiles(paramsEvent(String(instanceId)))) as ActionFailure;
    assertSanitizedFailure(result, SYNC_ENQUEUE_FAILED);

    assertEquals(loggedMeta.length > 0, true);
    const meta = loggedMeta[0] as { instanceId?: number; error?: unknown };
    assertEquals(meta.instanceId, instanceId);
    assertEquals(String(meta.error).includes('SECRET123'), true);
  } finally {
    restorePending();
    logger.error = originalError;
  }
});

migratedTest('saveMetadataProfiles: 5xx returns fixed message without raw detail', async () => {
  const lidarrId = createInstance('lidarr');

  const restoreLogger = withNoopLogger();
  const restoreSave = replace(arrSyncQueries, 'saveMetadataProfilesSync', () => {
    throw new Error(RAW_DB_ERROR);
  });
  try {
    const result = (await actions.saveMetadataProfiles(formEvent(String(lidarrId), () => {}))) as ActionFailure;
    assertSanitizedFailure(result, SAVE_METADATA_PROFILES_FAILED);
  } finally {
    restoreSave();
    restoreLogger();
  }
});

migratedTest('syncTrashGuideSource: 5xx returns fixed message without raw detail', async () => {
  const instanceId = createInstance('radarr');

  const restoreLogger = withNoopLogger();
  const restoreAssertScope = replace(trashGuideSyncQueries, 'assertScope', () => {
    throw new Error(RAW_DB_ERROR);
  });
  try {
    const result = (await actions.syncTrashGuideSource(
      formEvent(String(instanceId), (fd) => fd.set('sourceId', '1'))
    )) as ActionFailure;
    assertSanitizedFailure(result, TRASH_GUIDE_ACTION_FAILED);
  } finally {
    restoreAssertScope();
    restoreLogger();
  }
});

migratedTest('syncTrashGuideSource: specific 4xx domain errors are kept', async () => {
  const instanceId = createInstance('radarr');

  const restoreLogger = withNoopLogger();
  try {
    const scopeMessage = `Failed to validate TRaSH sync scope for instanceId=${instanceId}, sourceId=1`;
    const restoreScope = replace(trashGuideSyncQueries, 'assertScope', () => {
      throw new TrashGuideSyncScopeError('scope_not_found', scopeMessage);
    });
    try {
      const result = (await actions.syncTrashGuideSource(
        formEvent(String(instanceId), (fd) => fd.set('sourceId', '1'))
      )) as ActionFailure;
      assertEquals(result.status, 404);
      assertEquals(result.data?.error, scopeMessage);
    } finally {
      restoreScope();
    }

    const mismatchMessage = `TRaSH source arr_type mismatch: source arr_type=radarr, instance type=sonarr`;
    const restoreMismatch = replace(trashGuideSyncQueries, 'assertScope', () => {
      throw new TrashGuideSyncScopeError('arr_type_mismatch', mismatchMessage);
    });
    try {
      const result = (await actions.syncTrashGuideSource(
        formEvent(String(instanceId), (fd) => fd.set('sourceId', '1'))
      )) as ActionFailure;
      assertEquals(result.status, 422);
      assertEquals(result.data?.error, mismatchMessage);
    } finally {
      restoreMismatch();
    }

    const validationMessage = 'Invalid TRaSH sync trigger: bogus';
    const restoreValidation = replace(trashGuideSyncQueries, 'assertScope', () => {
      throw new TrashGuideSyncValidationError(validationMessage);
    });
    try {
      const result = (await actions.syncTrashGuideSource(
        formEvent(String(instanceId), (fd) => fd.set('sourceId', '1'))
      )) as ActionFailure;
      assertEquals(result.status, 400);
      assertEquals(result.data?.error, validationMessage);
    } finally {
      restoreValidation();
    }

    const restoreNotFound = replace(trashGuideSyncQueries, 'assertScope', () => {
      throw new TrashGuideSourceNotFoundError(1);
    });
    try {
      const result = (await actions.syncTrashGuideSource(
        formEvent(String(instanceId), (fd) => fd.set('sourceId', '1'))
      )) as ActionFailure;
      assertEquals(result.status, 404);
      assertEquals(result.data?.error, 'TRaSH source 1 not found');
    } finally {
      restoreNotFound();
    }
  } finally {
    restoreLogger();
  }
});

migratedTest('arr sync page actions: domain 4xx failures unchanged', async () => {
  const radarrId = createInstance('radarr');

  const invalidId = (await actions.syncDelayProfiles(paramsEvent('abc'))) as ActionFailure;
  assertEquals(invalidId.status, 400);
  assertEquals(invalidId.data?.error, 'Invalid instance ID');

  const unknownInstance = (await actions.syncDelayProfiles(paramsEvent('999999'))) as ActionFailure;
  assertEquals(unknownInstance.status, 404);
  assertEquals(unknownInstance.data?.error, 'Instance not found');

  const unsupported = (await actions.syncMetadataProfiles(paramsEvent(String(radarrId)))) as ActionFailure;
  assertEquals(unsupported.status, 400);
  assertEquals(unsupported.data?.error, 'Metadata profile sync is supported only for Lidarr instances');
});
