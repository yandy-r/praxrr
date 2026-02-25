import { assertEquals, assertMatch } from '@std/assert';
import { type CreateJobQueueInput, jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import { POST as sourcesPost } from '../../routes/api/v1/trash-guide/sources/+server.ts';
import { GET as sourceByIdGet } from '../../routes/api/v1/trash-guide/sources/[id]/+server.ts';
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
      ((input: CreateJobQueueInput) => {
        assertEquals(input.jobType, 'trashguide.sync');
        assertEquals(input.source, 'manual');
        assertEquals(input.dedupeKey, 'trashguide.sync:41');
        assertEquals(input.payload?.sourceId, 41);
        assertEquals(input.payload?.trigger, 'manual');
        assertEquals(typeof input.payload?.requestedAt, 'string');
        capturedRunAt = input.runAt;
        return createJobRecord(901, 'queued', input.runAt, Number(input.payload?.sourceId));
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
