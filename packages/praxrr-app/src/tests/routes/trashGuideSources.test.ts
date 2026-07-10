import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { type CreateJobQueueInput, jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import {
  trashGuideEntityCacheQueries,
  type TrashGuideEntityCacheWithSource,
} from '$db/queries/trashGuideEntityCache.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { logger } from '$logger/logger.ts';
import {
  trashGuideManager,
  TrashGuideSourceConflictError,
  TrashGuideSourceNotFoundError,
  TrashGuideSourceValidationError,
  type TrashGuideSourceUpdateInput,
} from '$lib/server/trashguide/manager.ts';
import { TrashGuideFetcherError } from '$lib/server/trashguide/types.ts';
import { TrashGuideTransformError } from '$lib/server/trashguide/transformer.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import type {
  JobQueueRecord,
  JobRunHistoryRecord,
  TrashGuideSyncRunEvidence,
  TrashGuideSyncStatusView,
} from '$jobs/queueTypes.ts';
import { POST as sourcesPost } from '../../routes/api/v1/trash-guide/sources/+server.ts';
import {
  DELETE as sourceByIdDelete,
  GET as sourceByIdGet,
  PUT as sourceByIdPut,
} from '../../routes/api/v1/trash-guide/sources/[id]/+server.ts';
import { GET as sourceEntitiesGet } from '../../routes/api/v1/trash-guide/sources/[id]/entities/+server.ts';
import {
  GET as sourceSyncGet,
  POST as sourceSyncPost,
} from '../../routes/api/v1/trash-guide/sources/[id]/sync/+server.ts';

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

function createSourceResponse(id: number, arrType: 'radarr' | 'sonarr') {
  return {
    id,
    name: `TRaSH ${arrType} ${id}`,
    repositoryUrl: `https://example.com/${arrType}.git`,
    branch: 'master',
    arrType,
    scoreProfile: 'default',
    autoPull: true,
    enabled: true,
    syncStrategy: 60,
    lastSyncedAt: null,
    lastCommitHash: null,
    entityCounts: {
      customFormats: 0,
      customFormatGroups: 0,
      qualityProfiles: 0,
      qualitySizes: 0,
      naming: 0,
    },
  };
}

function createJobRecord(
  id: number,
  status: JobQueueRecord['status'],
  runAt: string,
  sourceId: number,
  runToken?: string
): JobQueueRecord {
  return {
    id,
    jobType: 'trashguide.sync',
    status,
    runAt,
    payload: {
      sourceId,
      trigger: 'manual',
      requestedAt: runAt,
      ...(runToken !== undefined ? { runToken } : {}),
    },
    source: 'manual',
    dedupeKey: `trashguide.sync:${sourceId}`,
    cooldownUntil: null,
    attempts: 0,
    startedAt: status === 'running' ? runAt : null,
    finishedAt: null,
    createdAt: runAt,
    updatedAt: runAt,
  };
}

/**
 * Build a `trashGuideSourcesQueries.getById` stand-in that returns a live source snapshot.
 *
 * The sync queue helper resolves durable source identity via `getById` (issue #238), so every sync
 * test must patch it; this keeps the fake source in one place with an app-consistent `arr_type`.
 */
function patchedSourceLookup(
  arrType: TrashGuideSource['arr_type'] = 'radarr'
): typeof trashGuideSourcesQueries.getById {
  return ((id: number) =>
    createTrashGuideSource({
      id,
      name: `TRaSH ${arrType} ${id}`,
      arr_type: arrType,
    })) as typeof trashGuideSourcesQueries.getById;
}

Deno.test('trash guide sources POST rejects unsupported create fields', async () => {
  const response = await sourcesPost({
    request: new Request('http://localhost/api/v1/trash-guide/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'TRaSH Radarr',
        repositoryUrl: 'https://example.com/radarr.git',
        arrType: 'radarr',
        unexpected: true,
      }),
    }),
  } as unknown as Parameters<typeof sourcesPost>[0]);

  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Unsupported fields: unexpected');
});

Deno.test('trash guide sources POST rejects malformed JSON body', async () => {
  const response = await sourcesPost({
    request: new Request('http://localhost/api/v1/trash-guide/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name": "bad-json"',
    }),
  } as unknown as Parameters<typeof sourcesPost>[0]);

  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Invalid JSON body');
});

Deno.test('trash guide sources POST maps non-retryable fetcher errors to 422', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideManager,
    'createSource',
    (() => {
      throw new TrashGuideFetcherError('git_ref_error', 'Unknown branch', false);
    }) as typeof trashGuideManager.createSource,
    restores
  );

  try {
    const response = await sourcesPost({
      request: new Request('http://localhost/api/v1/trash-guide/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'TRaSH Radarr',
          repositoryUrl: 'https://example.com/radarr.git',
          arrType: 'radarr',
        }),
      }),
    } as unknown as Parameters<typeof sourcesPost>[0]);

    assertEquals(response.status, 422);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trash guide sources POST maps retryable fetcher errors to 502', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideManager,
    'createSource',
    (() => {
      throw new TrashGuideFetcherError('git_network_error', 'Network failure', true);
    }) as typeof trashGuideManager.createSource,
    restores
  );

  try {
    const response = await sourcesPost({
      request: new Request('http://localhost/api/v1/trash-guide/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'TRaSH Radarr',
          repositoryUrl: 'https://example.com/radarr.git',
          arrType: 'radarr',
        }),
      }),
    } as unknown as Parameters<typeof sourcesPost>[0]);

    assertEquals(response.status, 502);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trash guide sources POST maps transform errors to 422', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideManager,
    'createSource',
    (() => {
      throw new TrashGuideTransformError('ambiguous_mapping', 'transform failed');
    }) as typeof trashGuideManager.createSource,
    restores
  );

  try {
    const response = await sourcesPost({
      request: new Request('http://localhost/api/v1/trash-guide/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'TRaSH Radarr',
          repositoryUrl: 'https://example.com/radarr.git',
          arrType: 'radarr',
        }),
      }),
    } as unknown as Parameters<typeof sourcesPost>[0]);

    assertEquals(response.status, 422);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trash guide source PUT maps retryable fetcher errors to 502', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideManager,
    'updateSource',
    (() => {
      throw new TrashGuideFetcherError('git_auth_error', 'Auth failure', true);
    }) as typeof trashGuideManager.updateSource,
    restores
  );

  try {
    const response = await sourceByIdPut({
      params: { id: '77' },
      request: new Request('http://localhost/api/v1/trash-guide/sources/77', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      }),
    } as unknown as Parameters<typeof sourceByIdPut>[0]);

    assertEquals(response.status, 502);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trash guide source GET validates numeric source id', async () => {
  const response = await sourceByIdGet({
    params: { id: 'source-abc' },
  } as unknown as Parameters<typeof sourceByIdGet>[0]);

  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Invalid source id');
});

Deno.test({
  name: 'trash guide source entities GET returns source metadata in entity response shape',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const fetchedAt = '2026-02-26T11:22:33.000Z';
    const entities: TrashGuideEntityCacheWithSource[] = [
      {
        id: 1,
        sourceId: 64,
        trashId: 'cf-001',
        entityType: 'custom_format',
        name: 'TRaSH CF One',
        jsonData: JSON.stringify({
          name: 'TRaSH CF One',
          scores: {
            default: 55,
          },
        }),
        filePath: '/radarr/cf-one.json',
        contentHash: 'hash-cf-001',
        fetchedAt,
        source: {
          type: 'trash',
          id: 64,
          name: 'TRaSH radarr 64',
          arrType: 'radarr',
        },
      },
      {
        id: 2,
        sourceId: 64,
        trashId: 'qp-001',
        entityType: 'quality_profile',
        name: 'TRaSH QP One',
        jsonData: JSON.stringify({
          name: 'TRaSH QP One',
          group: 7,
        }),
        filePath: '/radarr/qp-one.json',
        contentHash: 'hash-qp-001',
        fetchedAt,
        source: {
          type: 'trash',
          id: 64,
          name: 'TRaSH radarr 64',
          arrType: 'radarr',
        },
      },
    ];

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => createSourceResponse(64, 'radarr')) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'getBySourceWithMetadata',
      ((sourceId: number) => {
        assertEquals(sourceId, 64);
        return entities;
      }) as typeof trashGuideEntityCacheQueries.getBySourceWithMetadata,
      restores
    );

    try {
      const response = await sourceEntitiesGet({
        params: { id: '64' },
        url: new URL('http://localhost/api/v1/trash-guide/sources/64/entities?arrType=radarr'),
      } as unknown as Parameters<typeof sourceEntitiesGet>[0]);

      assertEquals(response.status, 200);
      const payload = (await response.json()) as {
        entities: Array<{
          source: {
            type: 'trash';
            id: number;
            name: string;
            arrType: 'radarr' | 'sonarr';
          };
          trashId: string;
          type: string;
          name: string;
          filePath: string;
          fetchedAt: string;
          scores?: Record<string, number>;
          group?: number | null;
        }>;
        pagination: {
          limit: number;
          offset: number;
          nextCursor: string | null;
          total: number;
          hasMore: boolean;
        };
      };

      assertEquals(payload.entities.length, 2);
      assertEquals(payload.entities[0].source, {
        type: 'trash',
        id: 64,
        name: 'TRaSH radarr 64',
        arrType: 'radarr',
      });
      assertEquals(payload.entities[0].trashId, 'cf-001');
      assertEquals(payload.entities[0].scores, { default: 55 });

      assertEquals(payload.entities[1].source, {
        type: 'trash',
        id: 64,
        name: 'TRaSH radarr 64',
        arrType: 'radarr',
      });
      assertEquals(payload.entities[1].trashId, 'qp-001');
      assertEquals(payload.entities[1].group, 7);

      assertEquals(payload.pagination.limit, 50);
      assertEquals(payload.pagination.offset, 0);
      assertEquals(payload.pagination.nextCursor, null);
      assertEquals(payload.pagination.total, 2);
      assertEquals(payload.pagination.hasMore, false);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source sync POST enqueues manual sync job and notifies dispatcher',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    let capturedRunAt: string | null = null;
    let mintedRunToken: string | null = null;
    let slot: JobQueueRecord | undefined;
    const notifiedRunAts: string[] = [];

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => createSourceResponse(41, 'radarr')) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getById', patchedSourceLookup(), restores);
    patchTarget(jobQueueQueries, 'getByDedupeKey', (() => slot) as typeof jobQueueQueries.getByDedupeKey, restores);
    patchTarget(
      jobQueueQueries,
      'upsertScheduled',
      ((input: CreateJobQueueInput<'trashguide.sync'>) => {
        assertEquals(input.jobType, 'trashguide.sync');
        assertEquals(input.source, 'manual');
        assertEquals(input.dedupeKey, 'trashguide.sync:41');
        const payload = input.payload;
        if (!payload) {
          throw new Error('Expected payload for trashguide sync job');
        }
        assertEquals(payload.sourceId, 41);
        assertEquals(payload.trigger, 'manual');
        assertEquals(typeof payload.requestedAt, 'string');
        assertEquals(typeof payload.runToken, 'string');
        capturedRunAt = input.runAt;
        mintedRunToken = payload.runToken ?? null;
        slot = createJobRecord(901, 'queued', input.runAt, payload.sourceId, payload.runToken);
        return slot;
      }) as typeof jobQueueQueries.upsertScheduled,
      restores
    );
    patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);
    patchTarget(
      jobDispatcher,
      'notifyJobEnqueued',
      ((runAt: string) => {
        notifiedRunAts.push(runAt);
      }) as typeof jobDispatcher.notifyJobEnqueued,
      restores
    );

    try {
      const response = await sourceSyncPost({
        params: { id: '41' },
      } as unknown as Parameters<typeof sourceSyncPost>[0]);

      assertEquals(response.status, 200);
      const payload = (await response.json()) as {
        success: boolean;
        queued: boolean;
        runToken: string;
        statusUrl: string;
        view: TrashGuideSyncStatusView;
      };

      assertEquals(payload.success, true);
      assertEquals(payload.queued, true);
      assertEquals(typeof payload.runToken, 'string');
      assertEquals(payload.statusUrl, '/api/v1/trash-guide/sources/41/sync');
      assertEquals(payload.view.sourceId, 41);
      assertEquals(payload.view.current?.status, 'queued');
      assertEquals(typeof payload.view.current?.runToken, 'string');

      if (!capturedRunAt) {
        throw new Error('Expected upsertScheduled to be called');
      }
      assertEquals(payload.runToken, mintedRunToken);
      assertEquals(payload.view.current?.runToken, mintedRunToken);
      assertEquals(notifiedRunAts, [capturedRunAt]);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source sync POST returns 409 when a sync job is already running',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const runningAt = '2026-02-25T01:23:45.000Z';

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => createSourceResponse(52, 'sonarr')) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getById', patchedSourceLookup('sonarr'), restores);
    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => createJobRecord(920, 'running', runningAt, 52, 'run-token-920')) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
    patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);
    patchTarget(
      jobQueueQueries,
      'upsertScheduled',
      (() => {
        throw new Error('did not expect upsertScheduled when running job exists');
      }) as typeof jobQueueQueries.upsertScheduled,
      restores
    );

    try {
      const response = await sourceSyncPost({
        params: { id: '52' },
      } as unknown as Parameters<typeof sourceSyncPost>[0]);

      assertEquals(response.status, 409);
      const payload = (await response.json()) as {
        error: string;
        deduped: boolean;
        runToken: string;
        statusUrl: string;
        view: TrashGuideSyncStatusView;
      };

      assertMatch(payload.error, /already running/i);
      assertEquals(payload.deduped, true);
      assertEquals(payload.runToken, 'run-token-920');
      assertEquals(payload.statusUrl, '/api/v1/trash-guide/sources/52/sync');
      assertEquals(payload.view.queueId, 920);
      assertEquals(payload.view.current?.status, 'running');
      assertEquals(payload.view.current?.runAt, runningAt);
      assertEquals(payload.view.current?.startedAt, runningAt);
      assertEquals(payload.view.current?.runToken, 'run-token-920');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source sync POST returns 409 when dedupe upsert reports running job',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const runningAt = '2026-02-25T04:05:06.000Z';
    const latestRun: JobRunHistoryRecord = {
      id: 512,
      queueId: 941,
      jobType: 'trashguide.sync',
      status: 'failure',
      startedAt: '2026-02-25T04:05:00.000Z',
      finishedAt: '2026-02-25T04:05:05.000Z',
      durationMs: 5000,
      error: 'network timeout',
      output: null,
      evidence: null,
      createdAt: '2026-02-25T04:05:05.000Z',
    };

    // The queue slot races from queued -> running between the read and the upsert; the mock advances
    // the dedupe slot on upsert so the rebuilt status view reflects the now-running slot.
    let slot: JobQueueRecord | undefined = createJobRecord(940, 'queued', runningAt, 54, 'run-token-940');

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => createSourceResponse(54, 'radarr')) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(trashGuideSourcesQueries, 'getById', patchedSourceLookup(), restores);
    patchTarget(jobQueueQueries, 'getByDedupeKey', (() => slot) as typeof jobQueueQueries.getByDedupeKey, restores);
    patchTarget(
      jobQueueQueries,
      'upsertScheduled',
      (() => {
        slot = createJobRecord(941, 'running', runningAt, 54, 'run-token-941');
        return slot;
      }) as typeof jobQueueQueries.upsertScheduled,
      restores
    );
    patchTarget(
      jobRunHistoryQueries,
      'getByQueueId',
      (() => [latestRun]) as typeof jobRunHistoryQueries.getByQueueId,
      restores
    );
    patchTarget(
      jobDispatcher,
      'notifyJobEnqueued',
      (() => {
        throw new Error('did not expect notifyJobEnqueued when upsert resolves to running');
      }) as typeof jobDispatcher.notifyJobEnqueued,
      restores
    );

    try {
      const response = await sourceSyncPost({
        params: { id: '54' },
      } as unknown as Parameters<typeof sourceSyncPost>[0]);

      assertEquals(response.status, 409);
      const payload = (await response.json()) as {
        error: string;
        deduped: boolean;
        runToken: string;
        statusUrl: string;
        view: TrashGuideSyncStatusView;
      };

      assertMatch(payload.error, /already running/i);
      assertEquals(payload.deduped, true);
      assertEquals(payload.runToken, 'run-token-941');
      assertEquals(payload.statusUrl, '/api/v1/trash-guide/sources/54/sync');
      assertEquals(payload.view.queueId, 941);
      assertEquals(payload.view.current?.status, 'running');
      assertEquals(payload.view.current?.runAt, runningAt);
      assertEquals(payload.view.current?.startedAt, runningAt);
      assertEquals(payload.view.current?.attempts, 0);
      assertEquals(payload.view.current?.runToken, 'run-token-941');
      assertEquals(payload.view.latestRun, {
        id: 512,
        status: 'failure',
        startedAt: '2026-02-25T04:05:00.000Z',
        finishedAt: '2026-02-25T04:05:05.000Z',
        durationMs: 5000,
        evidence: null,
      });
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source sync GET returns status view with latest run evidence',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const queuedAt = '2026-02-27T08:00:00.000Z';
    const counts = {
      commitsBehind: 0,
      parsedFiles: 12,
      failedFiles: 0,
      activeOperations: 5,
      removedEntities: 1,
      renamedEntities: 2,
    };
    const evidence: TrashGuideSyncRunEvidence = {
      schemaVersion: 1,
      runToken: 'run-token-950',
      source: { id: 88, name: 'TRaSH radarr 88', arrType: 'radarr' },
      trigger: 'manual',
      requestedAt: queuedAt,
      status: 'success',
      counts,
      failure: null,
      retry: { rescheduleAt: null, retryable: false },
    };
    const terminalRun: JobRunHistoryRecord = {
      id: 777,
      queueId: 950,
      jobType: 'trashguide.sync',
      status: 'success',
      startedAt: '2026-02-27T08:00:01.000Z',
      finishedAt: '2026-02-27T08:00:09.000Z',
      durationMs: 8000,
      error: null,
      output: JSON.stringify(evidence),
      createdAt: '2026-02-27T08:00:09.000Z',
    };

    patchTarget(trashGuideSourcesQueries, 'getById', patchedSourceLookup(), restores);
    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => createJobRecord(950, 'queued', queuedAt, 88, 'run-token-950')) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
    patchTarget(
      jobRunHistoryQueries,
      'getByQueueId',
      (() => [terminalRun]) as typeof jobRunHistoryQueries.getByQueueId,
      restores
    );

    try {
      const response = await sourceSyncGet({
        params: { id: '88' },
      } as unknown as Parameters<typeof sourceSyncGet>[0]);

      assertEquals(response.status, 200);
      const payload = (await response.json()) as TrashGuideSyncStatusView;

      assertEquals(payload.sourceId, 88);
      assertEquals(payload.sourceName, 'TRaSH radarr 88');
      assertEquals(payload.arrType, 'radarr');
      assertEquals(payload.queueId, 950);
      assertEquals(payload.current?.status, 'queued');
      assertEquals(payload.current?.runToken, 'run-token-950');
      assertEquals(payload.latestRun?.id, 777);
      assertEquals(payload.latestRun?.status, 'success');
      assertEquals(payload.latestRun?.evidence?.counts, counts);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test('trash guide source sync POST validates numeric source id', async () => {
  const response = await sourceSyncPost({
    params: { id: 'not-a-number' },
  } as unknown as Parameters<typeof sourceSyncPost>[0]);

  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Invalid source id');
});

Deno.test({
  name: 'trash guide source sync POST returns 404 when the source is missing',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => {
        throw new TrashGuideSourceNotFoundError(404);
      }) as typeof trashGuideManager.getSource,
      restores
    );

    try {
      const response = await sourceSyncPost({
        params: { id: '404' },
      } as unknown as Parameters<typeof sourceSyncPost>[0]);

      assertEquals(response.status, 404);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'TRaSH source 404 not found');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source sync POST maps unexpected source-lookup failures to 500',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    let logged = false;

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => {
        throw new Error('unexpected lookup failure');
      }) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(
      logger,
      'error',
      (() => {
        logged = true;
        return Promise.resolve();
      }) as typeof logger.error,
      restores
    );

    try {
      const response = await sourceSyncPost({
        params: { id: '53' },
      } as unknown as Parameters<typeof sourceSyncPost>[0]);

      assertEquals(response.status, 500);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'unexpected lookup failure');
      assertEquals(logged, true);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source entities GET rejects arrType filter mismatch against source arrType',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => createSourceResponse(66, 'sonarr')) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(
      trashGuideEntityCacheQueries,
      'getBySourceWithMetadata',
      (() => {
        throw new Error('did not expect entity cache query on arrType mismatch');
      }) as typeof trashGuideEntityCacheQueries.getBySourceWithMetadata,
      restores
    );

    try {
      const response = await sourceEntitiesGet({
        params: { id: '66' },
        url: new URL('http://localhost/api/v1/trash-guide/sources/66/entities?arrType=radarr'),
      } as unknown as Parameters<typeof sourceEntitiesGet>[0]);

      assertEquals(response.status, 422);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'arrType filter mismatch for source: expected sonarr');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

function createTrashGuideSource(overrides: Partial<TrashGuideSource> = {}): TrashGuideSource {
  return {
    id: 7,
    name: 'TRaSH radarr 7',
    repository_url: 'https://example.com/radarr.git',
    branch: 'master',
    local_path: '/fake/clone/7',
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 60,
    auto_pull: true,
    enabled: true,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '2026-02-26T00:00:00.000Z',
    updated_at: '2026-02-26T00:00:00.000Z',
    ...overrides,
  };
}

// --- PUT field-level validation (parseUpdatePayload branches -> 400) ---

async function invokePut(id: string, body: string) {
  return await sourceByIdPut({
    params: { id },
    request: new Request(`http://localhost/api/v1/trash-guide/sources/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  } as unknown as Parameters<typeof sourceByIdPut>[0]);
}

Deno.test('trash guide source PUT rejects unsupported update fields', async () => {
  const response = await invokePut('5', JSON.stringify({ name: 'x', bogus: true }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Unsupported fields: bogus');
});

Deno.test('trash guide source PUT rejects empty update payload', async () => {
  const response = await invokePut('5', '{}');
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'At least one updatable field is required');
});

Deno.test('trash guide source PUT rejects non-object body', async () => {
  const response = await invokePut('5', '[]');
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Request body must be an object');
});

Deno.test('trash guide source PUT rejects malformed JSON body', async () => {
  const response = await invokePut('5', '{"name":');
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Invalid JSON body');
});

Deno.test('trash guide source PUT rejects empty name', async () => {
  const response = await invokePut('5', JSON.stringify({ name: '   ' }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'name cannot be empty');
});

Deno.test('trash guide source PUT rejects non-string name', async () => {
  const response = await invokePut('5', JSON.stringify({ name: 123 }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'name must be a string when provided');
});

Deno.test('trash guide source PUT rejects non-http repositoryUrl', async () => {
  const response = await invokePut('5', JSON.stringify({ repositoryUrl: 'ftp://example.com' }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'repositoryUrl must use http or https');
});

Deno.test('trash guide source PUT rejects malformed repositoryUrl', async () => {
  const response = await invokePut('5', JSON.stringify({ repositoryUrl: 'not a url' }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'repositoryUrl must be a valid URL');
});

Deno.test('trash guide source PUT rejects non-boolean enabled', async () => {
  const response = await invokePut('5', JSON.stringify({ enabled: 'yes' }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'enabled must be a boolean when provided');
});

Deno.test('trash guide source PUT rejects non-boolean autoPull', async () => {
  const response = await invokePut('5', JSON.stringify({ autoPull: 1 }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'autoPull must be a boolean when provided');
});

Deno.test('trash guide source PUT rejects non-integer syncStrategy', async () => {
  const response = await invokePut('5', JSON.stringify({ syncStrategy: 1.5 }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'syncStrategy must be an integer when provided');
});

Deno.test('trash guide source PUT rejects negative syncStrategy', async () => {
  const response = await invokePut('5', JSON.stringify({ syncStrategy: -1 }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'syncStrategy must be greater than or equal to 0');
});

Deno.test('trash guide source PUT validates numeric source id', async () => {
  const response = await invokePut('abc', JSON.stringify({ name: 'x' }));
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Invalid source id');
});

// --- PUT partial-update success (200) ---

Deno.test({
  name: 'trash guide source PUT applies single-field partial update and returns 200',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    let capturedId: number | undefined;
    let capturedInput: TrashGuideSourceUpdateInput | undefined;

    patchTarget(
      trashGuideManager,
      'updateSource',
      ((id: number, input: TrashGuideSourceUpdateInput) => {
        capturedId = id;
        capturedInput = input;
        return Promise.resolve(createSourceResponse(5, 'radarr'));
      }) as typeof trashGuideManager.updateSource,
      restores
    );

    try {
      const response = await invokePut('5', JSON.stringify({ name: 'Renamed Source' }));

      assertEquals(response.status, 200);
      const payload = (await response.json()) as { source: unknown };
      assertEquals(payload.source, createSourceResponse(5, 'radarr'));

      assertEquals(capturedId, 5);
      assertEquals(capturedInput?.name, 'Renamed Source');
      assertEquals(capturedInput?.repositoryUrl, undefined);
      assertEquals(capturedInput?.branch, undefined);
      assertEquals(capturedInput?.arrType, undefined);
      assertEquals(capturedInput?.scoreProfile, undefined);
      assertEquals(capturedInput?.autoPull, undefined);
      assertEquals(capturedInput?.enabled, undefined);
      assertEquals(capturedInput?.syncStrategy, undefined);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source PUT forwards multi-field partial patch',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    let capturedInput: TrashGuideSourceUpdateInput | undefined;

    patchTarget(
      trashGuideManager,
      'updateSource',
      ((_id: number, input: TrashGuideSourceUpdateInput) => {
        capturedInput = input;
        return Promise.resolve(createSourceResponse(6, 'sonarr'));
      }) as typeof trashGuideManager.updateSource,
      restores
    );

    try {
      const response = await invokePut('6', JSON.stringify({ enabled: false, syncStrategy: 120, autoPull: true }));

      assertEquals(response.status, 200);
      const payload = (await response.json()) as { source: unknown };
      assertEquals(payload.source, createSourceResponse(6, 'sonarr'));

      assertEquals(capturedInput?.enabled, false);
      assertEquals(capturedInput?.syncStrategy, 120);
      assertEquals(capturedInput?.autoPull, true);
      assertEquals(capturedInput?.name, undefined);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

// --- PUT arr_type immutability + conflict + 404 mapping ---

Deno.test({
  name: 'trash guide source PUT rejects arrType change with 422',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    let reached = false;

    patchTarget(
      trashGuideManager,
      'updateSource',
      (() => {
        reached = true;
        throw new TrashGuideSourceValidationError(
          'arr_type_mismatch',
          'TRaSH source arrType cannot be changed once created'
        );
      }) as typeof trashGuideManager.updateSource,
      restores
    );

    try {
      const response = await invokePut('5', JSON.stringify({ arrType: 'sonarr' }));

      assertEquals(response.status, 422);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'TRaSH source arrType cannot be changed once created');
      assertEquals(reached, true);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source PUT maps name conflict to 409',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    patchTarget(
      trashGuideManager,
      'updateSource',
      (() => {
        throw new TrashGuideSourceConflictError('name', 'TRaSH source name already exists: dup');
      }) as typeof trashGuideManager.updateSource,
      restores
    );

    try {
      const response = await invokePut('5', JSON.stringify({ name: 'dup' }));

      assertEquals(response.status, 409);
      const payload = (await response.json()) as { error: string };
      assertStringIncludes(payload.error, 'already exists');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source PUT returns 404 for missing source',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    patchTarget(
      trashGuideManager,
      'updateSource',
      (() => {
        throw new TrashGuideSourceNotFoundError(999);
      }) as typeof trashGuideManager.updateSource,
      restores
    );

    try {
      const response = await invokePut('999', JSON.stringify({ name: 'x' }));

      assertEquals(response.status, 404);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'TRaSH source 999 not found');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source PUT returns 404 without mutating when source is missing',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    let updateCalled = false;

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() => undefined) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'update',
      (() => {
        updateCalled = true;
        throw new Error('did not expect update when source is missing');
      }) as typeof trashGuideSourcesQueries.update,
      restores
    );

    try {
      const response = await invokePut('404', JSON.stringify({ name: 'x' }));

      assertEquals(response.status, 404);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'TRaSH source 404 not found');
      assertEquals(updateCalled, false);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

// --- GET 404 + positive-path contrast ---

Deno.test({
  name: 'trash guide source GET returns 404 for missing source',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => {
        throw new TrashGuideSourceNotFoundError(321);
      }) as typeof trashGuideManager.getSource,
      restores
    );

    try {
      const response = await sourceByIdGet({
        params: { id: '321' },
      } as unknown as Parameters<typeof sourceByIdGet>[0]);

      assertEquals(response.status, 404);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'TRaSH source 321 not found');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source GET returns source payload',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    patchTarget(
      trashGuideManager,
      'getSource',
      ((id: number) => {
        assertEquals(id, 8);
        return createSourceResponse(8, 'sonarr');
      }) as typeof trashGuideManager.getSource,
      restores
    );

    try {
      const response = await sourceByIdGet({
        params: { id: '8' },
      } as unknown as Parameters<typeof sourceByIdGet>[0]);

      assertEquals(response.status, 200);
      const payload = (await response.json()) as { source: unknown };
      assertEquals(payload.source, createSourceResponse(8, 'sonarr'));
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

// --- DELETE success, cascade delegation, 404, and id validation ---

Deno.test({
  name: 'trash guide source DELETE removes source and returns 204',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    let capturedId: number | undefined;

    patchTarget(
      trashGuideManager,
      'deleteSource',
      ((id: number) => {
        capturedId = id;
        return Promise.resolve();
      }) as typeof trashGuideManager.deleteSource,
      restores
    );

    try {
      const response = await sourceByIdDelete({
        params: { id: '7' },
      } as unknown as Parameters<typeof sourceByIdDelete>[0]);

      assertEquals(response.status, 204);
      assertEquals(await response.text(), '');
      assertEquals(capturedId, 7);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source DELETE cascades clone cleanup via unlink',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const fakeSource = createTrashGuideSource({ id: 7, local_path: '/fake/clone/7' });
    let deletedId: number | undefined;
    let removedPath: string | undefined;

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      ((id: number) => (id === 7 ? fakeSource : undefined)) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'delete',
      ((id: number) => {
        deletedId = id;
        return true;
      }) as typeof trashGuideSourcesQueries.delete,
      restores
    );
    patchTarget(
      Deno,
      'remove',
      ((path: string | URL) => {
        removedPath = String(path);
        return Promise.resolve();
      }) as typeof Deno.remove,
      restores
    );

    try {
      const response = await sourceByIdDelete({
        params: { id: '7' },
      } as unknown as Parameters<typeof sourceByIdDelete>[0]);

      assertEquals(response.status, 204);
      assertEquals(deletedId, 7);
      assertEquals(removedPath, '/fake/clone/7');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source DELETE returns 404 for missing source',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    patchTarget(
      trashGuideManager,
      'deleteSource',
      (() => {
        throw new TrashGuideSourceNotFoundError(404);
      }) as typeof trashGuideManager.deleteSource,
      restores
    );

    try {
      const response = await sourceByIdDelete({
        params: { id: '404' },
      } as unknown as Parameters<typeof sourceByIdDelete>[0]);

      assertEquals(response.status, 404);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'TRaSH source 404 not found');
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source DELETE returns 404 without mutating when source is missing',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    let deleteCalled = false;
    let removeCalled = false;

    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() => undefined) as typeof trashGuideSourcesQueries.getById,
      restores
    );
    patchTarget(
      trashGuideSourcesQueries,
      'delete',
      (() => {
        deleteCalled = true;
        throw new Error('did not expect delete when source is missing');
      }) as typeof trashGuideSourcesQueries.delete,
      restores
    );
    patchTarget(
      Deno,
      'remove',
      ((_path: string | URL) => {
        removeCalled = true;
        throw new Error('did not expect Deno.remove when source is missing');
      }) as typeof Deno.remove,
      restores
    );

    try {
      const response = await sourceByIdDelete({
        params: { id: '404' },
      } as unknown as Parameters<typeof sourceByIdDelete>[0]);

      assertEquals(response.status, 404);
      const payload = (await response.json()) as { error: string };
      assertEquals(payload.error, 'TRaSH source 404 not found');
      assertEquals(deleteCalled, false);
      assertEquals(removeCalled, false);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test('trash guide source DELETE validates numeric source id', async () => {
  const response = await sourceByIdDelete({
    params: { id: 'nope' },
  } as unknown as Parameters<typeof sourceByIdDelete>[0]);

  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertEquals(payload.error, 'Invalid source id');
});
