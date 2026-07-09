import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { canaryRolloutQueries, type InsertCanaryRolloutInput } from '$db/queries/canaryRollouts.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import { getSection } from '$sync/registry.ts';
import type { BaseSyncer, SectionType } from '$sync/types.ts';
import { BaseArrClient } from '$arr/base.ts';
import type { CanaryInstanceResult, CanaryTarget } from '$sync/canary/types.ts';

// Side-effect import registers the 'sync.canary.rollout' handler (and, transitively,
// arrSyncHandler + every section handler the rollout drives through executeSyncJob).
import '$jobs/handlers/canaryRollout.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (canary + arr_sync + sync_history tables all exist),
 * invoke the test body, then tear down. Mirrors driftCheck.test.ts (sanitizeOps is
 * relaxed because the rollout's best-effort logger/notify work is fire-and-forget).
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/canary-rollout-${crypto.randomUUID()}`;
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

type Restore = () => void;

/** Per-instance canary sync outcome the harness deterministically drives (offline). */
type SyncOutcome = 'success' | 'failure' | 'throw' | 'skipped';

function getHandler(): JobHandler {
  const handler = jobQueueRegistry.get('sync.canary.rollout');
  assertExists(handler, 'sync.canary.rollout handler should be registered');
  return handler;
}

function createRolloutJob(rolloutId: number, source: JobSource): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 9100,
    jobType: 'sync.canary.rollout',
    status: 'running',
    runAt: now,
    payload: { rolloutId },
    source,
    dedupeKey: `canary.rollout:${rolloutId}`,
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function seedRadarr(name: string): number {
  return arrInstancesQueries.create({
    name,
    type: 'radarr',
    url: 'http://127.0.0.1:1',
    apiKey: 'radarr-key',
  });
}

function target(instanceId: number, instanceName: string): CanaryTarget {
  return { instanceId, instanceName };
}

/**
 * Open a rollout and force it straight into `rolling_out` (the state the handler
 * requires), pre-seeding batch_cursor / rollout_results to simulate prior batches.
 */
function insertRollingOut(opts: {
  remaining: CanaryTarget[];
  maxBatchSize: number;
  sections?: SectionType[] | null;
  batchCursor?: number;
  rolloutResults?: CanaryInstanceResult[];
  overrides?: Partial<InsertCanaryRolloutInput>;
}): number {
  const id = canaryRolloutQueries.insert({
    arrType: 'radarr',
    canaryInstanceId: null,
    canaryInstanceName: 'Canary Radarr',
    sections: opts.sections === undefined ? ['qualityProfiles'] : opts.sections,
    maxBatchSize: opts.maxBatchSize,
    partialPolicy: 'gate',
    remainingTargets: opts.remaining,
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    stateToken: 'tok-arrange',
    ...opts.overrides,
  });
  db.execute(
    "UPDATE canary_rollouts SET status = 'rolling_out', batch_cursor = ?, rollout_results = ? WHERE id = ?",
    opts.batchCursor ?? 0,
    JSON.stringify(opts.rolloutResults ?? []),
    id
  );
  return id;
}

function baselineSyncConfigStatus() {
  const section = { trigger: 'manual' as const, cron: null, nextRunAt: null, syncStatus: 'idle' };
  return {
    qualityProfiles: { ...section },
    delayProfiles: { ...section },
    mediaManagement: { ...section },
    metadataProfiles: { ...section },
  };
}

/**
 * Drive the LIVE executeSyncJob deterministically and offline, keyed per instance id:
 *  - `getById` injects an api_key so getArrInstanceClient builds a never-networked client;
 *  - `getSystemStatus` is stubbed healthy so run-start version detection never networks;
 *  - `getSyncConfigStatus` THROWS for a `'throw'` instance (before any try in the handler),
 *    which is the whole point of the non-throwing per-instance processor contract;
 *  - the qualityProfiles section handler is stubbed so a `'success'`/`'failure'` instance
 *    runs a section (→ that final status) and a `'skipped'` instance has no config (→ skipped).
 *
 * executeSyncJob itself is a direct import in the handler and cannot be swapped, so its
 * outcome is mocked at these shared-singleton seams (the sanctioned pattern used by
 * arrSyncVersionGate.test.ts / driftCheck.test.ts).
 */
function drive(outcomes: Map<number, SyncOutcome>): { restore: Restore } {
  const restores: Restore[] = [];

  const originalGetById = arrInstancesQueries.getById;
  arrInstancesQueries.getById = (id: number) => {
    const row = originalGetById(id);
    return row ? ({ ...row, api_key: 'radarr-key' } as ArrInstance) : row;
  };
  restores.push(() => {
    arrInstancesQueries.getById = originalGetById;
  });

  const originalGetSystemStatus = BaseArrClient.prototype.getSystemStatus;
  BaseArrClient.prototype.getSystemStatus = () =>
    Promise.resolve({ ok: true as const, appName: 'Radarr', version: '5.14.0.9383' });
  restores.push(() => {
    BaseArrClient.prototype.getSystemStatus = originalGetSystemStatus;
  });

  const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
  arrSyncQueries.getSyncConfigStatus = ((id: number) => {
    if (outcomes.get(id) === 'throw') {
      throw new Error(`sync config exploded for ${id}`);
    }
    return baselineSyncConfigStatus();
  }) as typeof arrSyncQueries.getSyncConfigStatus;
  restores.push(() => {
    arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
  });

  const originalGetNextScheduledRunAt = arrSyncQueries.getNextScheduledRunAt;
  arrSyncQueries.getNextScheduledRunAt = () => null;
  restores.push(() => {
    arrSyncQueries.getNextScheduledRunAt = originalGetNextScheduledRunAt;
  });

  const qp = getSection('qualityProfiles');
  const originalHasConfig = qp.hasConfig;
  const originalSetStatusPending = qp.setStatusPending;
  const originalClaimSync = qp.claimSync;
  const originalCompleteSync = qp.completeSync;
  const originalFailSync = qp.failSync;
  const originalSetNextRunAt = qp.setNextRunAt;
  const originalCreateSyncer = qp.createSyncer;

  // 'success'/'failure' targets have config (a section runs); 'skipped' targets do not.
  qp.hasConfig = (id: number) => {
    const outcome = outcomes.get(id);
    return outcome === 'success' || outcome === 'failure';
  };
  qp.setStatusPending = () => undefined;
  qp.claimSync = () => true;
  qp.completeSync = () => undefined;
  qp.failSync = () => undefined;
  qp.setNextRunAt = () => undefined;
  qp.createSyncer = (_client, instance) =>
    ({
      sync: async () => {
        if (outcomes.get(instance.id) === 'failure') {
          return { success: false, itemsSynced: 0, error: `sync failed for ${instance.id}` };
        }
        return { success: true, itemsSynced: 1 };
      },
      generatePreview: async () => ({ section: 'qualityProfiles', profile: null }),
      setPreviewConfig: () => undefined,
      clearPreviewConfig: () => undefined,
    }) as unknown as BaseSyncer;

  restores.push(() => {
    qp.hasConfig = originalHasConfig;
    qp.setStatusPending = originalSetStatusPending;
    qp.claimSync = originalClaimSync;
    qp.completeSync = originalCompleteSync;
    qp.failSync = originalFailSync;
    qp.setNextRunAt = originalSetNextRunAt;
    qp.createSyncer = originalCreateSyncer;
  });

  return {
    restore: () => {
      for (const restore of restores.reverse()) {
        restore();
      }
    },
  };
}

function resultsById(rolloutId: number): Map<number, CanaryInstanceResult> {
  const detail = canaryRolloutQueries.getById(rolloutId);
  assertExists(detail);
  return new Map(detail.rolloutResults.map((result) => [result.instanceId, result]));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

Deno.test('sync.canary.rollout handler is registered in the queue registry', () => {
  assertExists(jobQueueRegistry.get('sync.canary.rollout'));
});

// ---------------------------------------------------------------------------
// Non-throwing per-instance processor: a throw in executeSyncJob must not lose siblings
// ---------------------------------------------------------------------------

migratedTest('a target that throws inside executeSyncJob is recorded as failure; siblings still sync', async () => {
  const handler = getHandler();
  const a = seedRadarr('Radarr A');
  const b = seedRadarr('Radarr B');
  const c = seedRadarr('Radarr C');

  // Middle target throws; the whole batch runs under Promise.all, so a non-contained throw
  // would reject the batch and drop A and C. They must all survive.
  const outcomes = new Map<number, SyncOutcome>([
    [a, 'success'],
    [b, 'throw'],
    [c, 'success'],
  ]);
  const id = insertRollingOut({
    remaining: [target(a, 'Radarr A'), target(b, 'Radarr B'), target(c, 'Radarr C')],
    maxBatchSize: 3,
  });

  const { restore } = drive(outcomes);
  try {
    const result = await handler(createRolloutJob(id, 'manual'));

    const byId = resultsById(id);
    assertEquals(byId.size, 3, 'siblings of the throwing target must not be lost');
    assertEquals(byId.get(a)?.status, 'success');
    assertEquals(byId.get(c)?.status, 'success');

    // The throw is caught at the EXACT instance id and surfaced as a failure result.
    const failed = byId.get(b);
    assertExists(failed);
    assertEquals(failed.instanceId, b);
    assertEquals(failed.status, 'failure');
    assertEquals(failed.error, `sync config exploded for ${b}`);

    // Not every remaining instance synced -> the rollout finishes failed.
    assertEquals(canaryRolloutQueries.getById(id)?.status, 'failed');
    assertEquals(result.status, 'failure');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Deleted / disabled targets -> skipped at the exact instance id (no sibling fallback)
// ---------------------------------------------------------------------------

migratedTest('a deleted or disabled remaining target is skipped at its exact instance id', async () => {
  const handler = getHandler();
  const a = seedRadarr('Radarr A');
  const deleted = seedRadarr('Radarr Deleted');
  const disabled = seedRadarr('Radarr Disabled');

  arrInstancesQueries.delete(deleted);
  arrInstancesQueries.update(disabled, { enabled: false });

  const outcomes = new Map<number, SyncOutcome>([[a, 'success']]);
  const id = insertRollingOut({
    remaining: [target(a, 'Radarr A'), target(deleted, 'Radarr Deleted'), target(disabled, 'Radarr Disabled')],
    maxBatchSize: 3,
  });

  const { restore } = drive(outcomes);
  try {
    await handler(createRolloutJob(id, 'manual'));

    const byId = resultsById(id);
    assertEquals(byId.size, 3);
    assertEquals(byId.get(a)?.status, 'success');
    // Scoped to the exact id — a missing/disabled instance never falls back to a sibling.
    assertEquals(byId.get(deleted)?.status, 'skipped');
    assertEquals(byId.get(deleted)?.instanceId, deleted);
    assertEquals(byId.get(disabled)?.status, 'skipped');
    assertEquals(byId.get(disabled)?.instanceId, disabled);

    // A skipped instance (deleted/disabled between the gate and rollout) is benign, not a
    // failure -> a run with only successes and skips finishes `completed`, not `failed`.
    assertEquals(canaryRolloutQueries.getById(id)?.status, 'completed');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// max_batch_size N=1: one target per pass, unconditional reschedule while cursor < length
// ---------------------------------------------------------------------------

migratedTest(
  'max_batch_size=1 syncs one target per pass and reschedules unconditionally for source manual',
  async () => {
    const handler = getHandler();
    const a = seedRadarr('Radarr A');
    const b = seedRadarr('Radarr B');
    const c = seedRadarr('Radarr C');

    const outcomes = new Map<number, SyncOutcome>([
      [a, 'success'],
      [b, 'success'],
      [c, 'success'],
    ]);
    const id = insertRollingOut({
      remaining: [target(a, 'Radarr A'), target(b, 'Radarr B'), target(c, 'Radarr C')],
      maxBatchSize: 1,
    });

    const { restore } = drive(outcomes);
    try {
      // Pass 1: only A. source is 'manual', yet it MUST reschedule (no schedule-source guard).
      const pass1 = await handler(createRolloutJob(id, 'manual'));
      assertEquals(pass1.status, 'success');
      assertExists(pass1.rescheduleAt, 'manual-source rollout must reschedule while targets remain');
      let detail = canaryRolloutQueries.getById(id);
      assertExists(detail);
      assertEquals(detail.status, 'rolling_out');
      assertEquals(detail.batchCursor, 1);
      assertEquals(
        detail.rolloutResults.map((r) => r.instanceId),
        [a]
      );

      // Pass 2: only B, still rescheduling.
      const pass2 = await handler(createRolloutJob(id, 'manual'));
      assertExists(pass2.rescheduleAt);
      detail = canaryRolloutQueries.getById(id);
      assertExists(detail);
      assertEquals(detail.batchCursor, 2);
      assertEquals(
        detail.rolloutResults.map((r) => r.instanceId),
        [a, b]
      );

      // Pass 3: terminal batch (C). No reschedule; all-success -> completed.
      const pass3 = await handler(createRolloutJob(id, 'manual'));
      assertEquals(pass3.status, 'success');
      assertEquals(pass3.rescheduleAt, undefined);
      detail = canaryRolloutQueries.getById(id);
      assertExists(detail);
      assertEquals(detail.status, 'completed');
      assertEquals(detail.batchCursor, 3);
      assertEquals(
        detail.rolloutResults.map((r) => r.instanceId),
        [a, b, c]
      );
    } finally {
      restore();
    }
  }
);

// ---------------------------------------------------------------------------
// max_batch_size N=3: whole cohort in one Promise.all batch, then completes
// ---------------------------------------------------------------------------

migratedTest('max_batch_size=3 syncs the whole remaining cohort in one pass and completes', async () => {
  const handler = getHandler();
  const a = seedRadarr('Radarr A');
  const b = seedRadarr('Radarr B');
  const c = seedRadarr('Radarr C');

  const outcomes = new Map<number, SyncOutcome>([
    [a, 'success'],
    [b, 'success'],
    [c, 'success'],
  ]);
  const id = insertRollingOut({
    remaining: [target(a, 'Radarr A'), target(b, 'Radarr B'), target(c, 'Radarr C')],
    maxBatchSize: 3,
  });

  const { restore } = drive(outcomes);
  try {
    const result = await handler(createRolloutJob(id, 'manual'));

    assertEquals(result.status, 'success');
    assertEquals(result.rescheduleAt, undefined, 'a single terminal batch does not reschedule');
    const detail = canaryRolloutQueries.getById(id);
    assertExists(detail);
    assertEquals(detail.status, 'completed');
    assertEquals(detail.batchCursor, 3);
    assertEquals(
      detail.rolloutResults.map((r) => r.instanceId).sort((x, y) => x - y),
      [a, b, c].sort((x, y) => x - y)
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Resume from a persisted cursor (the recovery re-run path)
// ---------------------------------------------------------------------------

migratedTest('resumes from a persisted batch_cursor and re-runs only the remainder (recovery path)', async () => {
  const handler = getHandler();
  const a = seedRadarr('Radarr A');
  const b = seedRadarr('Radarr B');
  const c = seedRadarr('Radarr C');

  // A already synced in a prior batch: cursor=1, its result pre-seeded with a sentinel output.
  const priorA: CanaryInstanceResult = {
    instanceId: a,
    instanceName: 'Radarr A',
    status: 'success',
    output: 'prior-batch-A',
  };
  const outcomes = new Map<number, SyncOutcome>([
    [b, 'success'],
    [c, 'success'],
  ]);
  const id = insertRollingOut({
    remaining: [target(a, 'Radarr A'), target(b, 'Radarr B'), target(c, 'Radarr C')],
    maxBatchSize: 3,
    batchCursor: 1,
    rolloutResults: [priorA],
  });

  const { restore } = drive(outcomes);
  try {
    const result = await handler(createRolloutJob(id, 'manual'));

    assertEquals(result.status, 'success');
    const detail = canaryRolloutQueries.getById(id);
    assertExists(detail);
    assertEquals(detail.status, 'completed');
    assertEquals(detail.batchCursor, 3);

    const byId = resultsById(id);
    assertEquals(byId.size, 3);
    assertEquals(byId.get(b)?.status, 'success');
    assertEquals(byId.get(c)?.status, 'success');
    // A was beyond the cursor and must NOT be re-synced — its prior sentinel result survives.
    assertEquals(byId.get(a)?.output, 'prior-batch-A');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// jobQueueQueries.recoverRunning re-queues an interrupted rollout job -> handler resumes
// ---------------------------------------------------------------------------

migratedTest('recoverRunning re-queues an interrupted rollout job and the handler resumes from cursor', async () => {
  const handler = getHandler();
  const a = seedRadarr('Radarr A');
  const b = seedRadarr('Radarr B');

  const priorA: CanaryInstanceResult = {
    instanceId: a,
    instanceName: 'Radarr A',
    status: 'success',
    output: 'prior-batch-A',
  };
  const outcomes = new Map<number, SyncOutcome>([[b, 'success']]);
  const rolloutId = insertRollingOut({
    remaining: [target(a, 'Radarr A'), target(b, 'Radarr B')],
    maxBatchSize: 3,
    batchCursor: 1,
    rolloutResults: [priorA],
  });

  // Enqueue the resumable rollout job and mark it 'running' (mid-batch crash simulation).
  const now = new Date().toISOString();
  const jobId = jobQueueQueries.create({
    jobType: 'sync.canary.rollout',
    payload: { rolloutId },
    source: 'manual',
    runAt: now,
    dedupeKey: `canary.rollout:${rolloutId}`,
  });
  db.execute("UPDATE job_queue SET status = 'running', started_at = ? WHERE id = ?", now, jobId);

  // Startup recovery flips 'running' back to 'queued' so the dispatcher re-runs it.
  const recovered = jobQueueQueries.recoverRunning();
  assertEquals(recovered, 1);
  assertEquals(jobQueueQueries.getById(jobId)?.status, 'queued');

  const { restore } = drive(outcomes);
  try {
    // Re-dispatch resumes from the persisted cursor (only B remains) and finishes.
    const result = await handler(createRolloutJob(rolloutId, 'manual'));
    assertEquals(result.status, 'success');

    const detail = canaryRolloutQueries.getById(rolloutId);
    assertExists(detail);
    assertEquals(detail.status, 'completed');
    assertEquals(detail.batchCursor, 2);
    const byId = resultsById(rolloutId);
    assertEquals(byId.get(a)?.output, 'prior-batch-A');
    assertEquals(byId.get(b)?.status, 'success');
  } finally {
    restore();
  }
});
