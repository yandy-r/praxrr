import { assert, assertEquals } from '@std/assert';
import { jobQueueRegistry } from '../../lib/server/jobs/queueRegistry.ts';
import { trashGuideSourcesQueries } from '../../lib/server/db/queries/trashGuideSources.ts';
import { logger } from '../../lib/server/utils/logger/logger.ts';
import { trashGuideManager } from '../../lib/server/trashguide/index.ts';
import type { JobQueueRecord } from '../../lib/server/jobs/queueTypes.ts';

// Register TRaSH sync handler for this test run.
import '../../lib/server/jobs/handlers/trashGuideSync.ts';

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

Deno.test('trashGuideSync handler maps sync() throw into failure retry flow', async () => {
  const restores: Restore[] = [];
  const source = {
    id: 901,
    name: 'TRaSH Handler Source',
    repository_url: 'https://example.com/handler-source.git',
    branch: 'main',
    local_path: '/tmp/trash-guide-source',
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 60,
    auto_pull: true,
    enabled: true,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '2026-02-26T00:00:00.000Z',
    updated_at: '2026-02-26T00:00:00.000Z',
  };
  const errors: string[] = [];

  patchTarget(trashGuideSourcesQueries, 'getById', (() => source) as typeof trashGuideSourcesQueries.getById, restores);
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (async () => ({
      hasUpdates: true,
      commitsBehind: 2,
      commitsAhead: 0,
      latestRemoteCommit: 'remote-commit',
      currentLocalCommit: 'local-commit',
    })) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      throw new Error('git network failure while pulling');
    }) as typeof trashGuideManager.sync,
    restores
  );
  patchTarget(
    logger,
    'error',
    ((message: string, meta: { error: string }) => {
      errors.push(`${message}:${meta.error}`);
      return Promise.resolve();
    }) as typeof logger.error,
    restores
  );

  const handler = jobQueueRegistry.get('trashguide.sync');
  if (!handler) {
    throw new Error('Expected trashguide.sync handler to be registered');
  }

  const now = '2026-02-26T10:00:00.000Z';
  const job: JobQueueRecord = {
    id: 1200,
    jobType: 'trashguide.sync',
    status: 'queued',
    runAt: now,
    payload: { sourceId: 901, trigger: 'scheduled' },
    source: 'schedule',
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 1,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await handler(job);
    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'gitNetwork');
    assert(!JSON.stringify(result).includes('git network failure while pulling'));
    assertEquals(typeof result.rescheduleAt, 'string');
    assertEquals(errors.length, 1);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
