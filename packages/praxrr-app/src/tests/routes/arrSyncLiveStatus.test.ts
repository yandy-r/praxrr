// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import type { ArrSyncSection, JobType } from '$jobs/queueTypes.ts';
import { load } from '../../routes/arr/[id]/sync/+page.server.ts';

type LoadEvent = Parameters<typeof load>[0];
type SectionStatus = Record<ArrSyncSection, string>;

// Mirrors the migratedTest harness in tests/routes/syncHistory.test.ts.
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/arr-sync-live-status-${crypto.randomUUID()}`;
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

function createInstance(type: 'radarr' | 'sonarr' = 'radarr'): number {
  return arrInstancesQueries.create({
    name: `${type} ${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

/** Seed delay + quality profile config rows and mark both sections pending (should_sync). */
function markSectionsPending(instanceId: number): void {
  arrSyncQueries.saveQualityProfilesSync(instanceId, [], { trigger: 'manual', cron: null });
  arrSyncQueries.saveDelayProfilesSync(instanceId, {
    databaseId: null,
    profileName: null,
    trigger: 'manual',
    cron: null,
  });
  arrSyncQueries.setQualityProfilesStatusPending(instanceId);
  arrSyncQueries.setDelayProfilesStatusPending(instanceId);
}

function enqueue(jobType: JobType, instanceId: number, extraPayload: Record<string, unknown> = {}): number {
  return jobQueueQueries.create({
    jobType,
    runAt: new Date().toISOString(),
    payload: { instanceId, ...extraPayload } as never,
    source: 'manual',
  });
}

async function loadSectionStatus(instanceId: number): Promise<SectionStatus> {
  const event = {
    params: { id: String(instanceId) },
    url: new URL(`http://localhost/arr/${instanceId}/sync`),
    depends: () => {},
  } as unknown as LoadEvent;
  const data = (await load(event)) as { sectionStatus: SectionStatus };
  return data.sectionStatus;
}

migratedTest('arr sync load: running section job reports its pending section as in_progress', async () => {
  const instanceId = createInstance();
  markSectionsPending(instanceId);
  const jobId = enqueue('arr.sync.qualityProfiles', instanceId);
  jobQueueQueries.setStatus(jobId, 'running');
  // A queued job for the other section keeps it pending.
  enqueue('arr.sync.delayProfiles', instanceId);

  const status = await loadSectionStatus(instanceId);
  assertEquals(status.qualityProfiles, 'in_progress');
  assertEquals(status.delayProfiles, 'pending');
});

migratedTest('arr sync load: running aggregate arr.sync job covers its payload sections only', async () => {
  const instanceId = createInstance();
  markSectionsPending(instanceId);
  const jobId = enqueue('arr.sync', instanceId, { sections: ['delayProfiles'] });
  jobQueueQueries.setStatus(jobId, 'running');

  const status = await loadSectionStatus(instanceId);
  assertEquals(status.delayProfiles, 'in_progress');
  // Not covered by any active job: stale pending collapses to idle.
  assertEquals(status.qualityProfiles, 'idle');
});

migratedTest('arr sync load: queued job keeps the section pending', async () => {
  const instanceId = createInstance();
  markSectionsPending(instanceId);
  enqueue('arr.sync.qualityProfiles', instanceId);
  enqueue('arr.sync.delayProfiles', instanceId);

  const status = await loadSectionStatus(instanceId);
  assertEquals(status.qualityProfiles, 'pending');
  assertEquals(status.delayProfiles, 'pending');
});

migratedTest('arr sync load: pending section without an active job is not reported as pending', async () => {
  const instanceId = createInstance();
  markSectionsPending(instanceId);
  // Finished and cancelled jobs are not active.
  jobQueueQueries.markFinished(enqueue('arr.sync.qualityProfiles', instanceId), 'cancelled');
  jobQueueQueries.markFinished(enqueue('arr.sync.delayProfiles', instanceId), 'success');

  const status = await loadSectionStatus(instanceId);
  assertEquals(status.qualityProfiles, 'idle');
  assertEquals(status.delayProfiles, 'idle');
});

migratedTest('arr sync load: active jobs for another instance never affect this instance', async () => {
  const instanceId = createInstance('radarr');
  const otherId = createInstance('sonarr');
  markSectionsPending(instanceId);
  const jobId = enqueue('arr.sync.qualityProfiles', otherId);
  jobQueueQueries.setStatus(jobId, 'running');
  enqueue('arr.sync.delayProfiles', otherId);

  const status = await loadSectionStatus(instanceId);
  assertEquals(status.qualityProfiles, 'idle');
  assertEquals(status.delayProfiles, 'idle');
});

migratedTest('arr sync load: future-dated scheduled job does not keep a section pending', async () => {
  const instanceId = createInstance();
  markSectionsPending(instanceId);
  jobQueueQueries.create({
    jobType: 'arr.sync.qualityProfiles',
    runAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    payload: { instanceId },
    source: 'schedule',
    dedupeKey: `arr.sync.qualityProfiles:${instanceId}`,
  });

  const status = await loadSectionStatus(instanceId);
  assertEquals(status.qualityProfiles, 'idle');
});

migratedTest('arr sync load: in_progress section without a running job is left as persisted', async () => {
  const instanceId = createInstance();
  markSectionsPending(instanceId);
  arrSyncQueries.claimQualityProfilesSync(instanceId);

  const status = await loadSectionStatus(instanceId);
  assertEquals(status.qualityProfiles, 'in_progress');
});
