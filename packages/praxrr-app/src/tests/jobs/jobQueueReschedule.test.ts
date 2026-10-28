import { assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';

// ============================================================================
// jobQueueQueries.reschedule — the recurring-slot handoff (YAN-452). A manual run that finishes
// re-queues its row as the scheduled slot: source and payload are replaced ONLY when provided;
// otherwise (e.g. canary rollout continuations) the row keeps its existing source and payload.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/job-queue-reschedule-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function createManualRunningJob(dedupeKey: string): number {
  const id = jobQueueQueries.create({
    jobType: 'trashguide.sync',
    runAt: '2026-03-01T00:00:00.000Z',
    payload: { sourceId: 7, trigger: 'manual', runToken: 'tok-manual' },
    source: 'manual',
    dedupeKey,
  });
  db.execute(`UPDATE job_queue SET status = 'running' WHERE id = ?`, id);
  return id;
}

migratedTest('reschedule sets source and replaces the payload when both are given', () => {
  const id = createManualRunningJob('trashguide.sync:7');
  const runAt = '2026-03-01T01:00:00.000Z';

  jobQueueQueries.reschedule(id, runAt, null, {
    source: 'schedule',
    payload: { sourceId: 7, trigger: 'scheduled', runToken: 'tok-next' },
  });

  const row = jobQueueQueries.getById(id);
  assertEquals(row?.status, 'queued');
  assertEquals(row?.source, 'schedule');
  assertEquals(row?.runAt, runAt);
  assertEquals(row?.payload, { sourceId: 7, trigger: 'scheduled', runToken: 'tok-next' });
});

migratedTest('reschedule without options keeps the existing source and payload', () => {
  const id = createManualRunningJob('trashguide.sync:8');

  jobQueueQueries.reschedule(id, '2026-03-01T01:00:00.000Z');

  const row = jobQueueQueries.getById(id);
  assertEquals(row?.status, 'queued');
  assertEquals(row?.source, 'manual');
  assertEquals(row?.payload, { sourceId: 7, trigger: 'manual', runToken: 'tok-manual' });
});
