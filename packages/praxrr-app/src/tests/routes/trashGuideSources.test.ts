import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { type CreateJobQueueInput, jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { TrashGuideFetcherError } from '$lib/server/trashguide/types.ts';
import { TrashGuideTransformError } from '$lib/server/trashguide/transformer.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import { POST as sourcesPost } from '../../routes/api/v1/trash-guide/sources/+server.ts';
import { GET as sourceByIdGet, PUT as sourceByIdPut } from '../../routes/api/v1/trash-guide/sources/[id]/+server.ts';
import { GET as sourceEntitiesGet } from '../../routes/api/v1/trash-guide/sources/[id]/entities/+server.ts';
import { POST as sourceSyncPost } from '../../routes/api/v1/trash-guide/sources/[id]/sync/+server.ts';

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
  sourceId: number
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
  name: 'trash guide source sync POST enqueues manual sync job and notifies dispatcher',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    let capturedRunAt: string | null = null;
    const notifiedRunAts: string[] = [];

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => createSourceResponse(41, 'radarr')) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => undefined) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
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
        capturedRunAt = input.runAt;
        return createJobRecord(901, 'queued', input.runAt, Number(payload.sourceId));
      }) as typeof jobQueueQueries.upsertScheduled,
      restores
    );
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
        job: {
          id: number;
          status: string;
          runAt: string;
          source: string;
          attempts: number;
        };
      };

      assertEquals(payload.success, true);
      assertEquals(payload.queued, true);
      assertEquals(payload.job.id, 901);
      if (!capturedRunAt) {
        throw new Error('Expected upsertScheduled to be called');
      }
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
    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => createJobRecord(920, 'running', runningAt, 52)) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'getById',
      ((id: number) =>
        id === 920 ? createJobRecord(920, 'running', runningAt, 52) : undefined) as typeof jobQueueQueries.getById,
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
        run: {
          queueId: number;
          current: { status: string; runAt: string; startedAt: string | null };
        };
      };

      assertMatch(payload.error, /already running/i);
      assertEquals(payload.run.queueId, 920);
      assertEquals(payload.run.current.status, 'running');
      assertEquals(payload.run.current.runAt, runningAt);
      assertEquals(payload.run.current.startedAt, runningAt);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  },
});

Deno.test({
  name: 'trash guide source sync POST returns 500 if running queue metadata disappears',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const runningAt = '2026-02-25T01:23:45.000Z';

    patchTarget(
      trashGuideManager,
      'getSource',
      (() => createSourceResponse(53, 'sonarr')) as typeof trashGuideManager.getSource,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => createJobRecord(930, 'running', runningAt, 53)) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
    patchTarget(jobQueueQueries, 'getById', (() => undefined) as typeof jobQueueQueries.getById, restores);
    patchTarget(
      jobQueueQueries,
      'upsertScheduled',
      (() => {
        throw new Error('did not expect upsertScheduled when running job metadata is missing');
      }) as typeof jobQueueQueries.upsertScheduled,
      restores
    );

    try {
      const response = await sourceSyncPost({
        params: { id: '53' },
      } as unknown as Parameters<typeof sourceSyncPost>[0]);

      assertEquals(response.status, 500);
      const payload = (await response.json()) as { error: string };

      assertStringIncludes(payload.error, 'queueId=930');
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
