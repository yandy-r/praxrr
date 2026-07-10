import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord } from '$jobs/queueTypes.ts';
import { calculateNextRunFromMinutes } from '$jobs/scheduleUtils.ts';
import { logger } from '$logger/logger.ts';

// Side-effect import registers the 'drift.check' handler.
import '$jobs/handlers/driftCheck.ts';

// ============================================================================
// DB bootstrap: point the db singleton at a scratch SQLite file under a fresh
// temp base path and run the full migration chain (so drift_check_settings /
// drift_instance_status / arr_instances all exist), then tear down. Mirrors the
// arrSyncVersionGate suite's migratedTest helper.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/drift-check-${crypto.randomUUID()}`;
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

function getHandler(): JobHandler {
  const handler = jobQueueRegistry.get('drift.check');
  assertExists(handler, 'drift.check handler should be registered');
  return handler;
}

/**
 * Build a scheduled drift.check job record. The chunk/terminal/backoff continuation logic
 * only engages when `source === 'schedule'`, matching the recurring dispatcher.
 */
function createDriftJob(overrides: Partial<JobQueueRecord> = {}): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 4200,
    jobType: 'drift.check',
    status: 'running',
    runAt: now,
    payload: {},
    source: 'schedule',
    dedupeKey: 'drift.check:global',
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create N enabled instances, alternating radarr/sonarr, all pointed at an unreachable
 * loopback address so each real `checkAndPersistInstance` heartbeat fails fast (connection
 * refused → 'unreachable') and still upserts a `drift_instance_status` row. Returns the
 * created ids sorted ascending (chunking is id-ordered regardless of insert order).
 */
function seedEnabledInstances(count: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(
      arrInstancesQueries.create({
        name: `Drift Instance ${String.fromCharCode(90 - i)}`, // Z, Y, X... so name-order != id-order
        type: i % 2 === 0 ? 'radarr' : 'sonarr',
        url: 'http://127.0.0.1:1',
        apiKey: `drift-key-${i}`,
      })
    );
  }
  return ids.sort((a, b) => a - b);
}

function persistedStatusIds(): number[] {
  const rows = db.query<{ arr_instance_id: number }>(
    'SELECT arr_instance_id FROM drift_instance_status ORDER BY arr_instance_id'
  );
  return rows.map((row) => row.arr_instance_id);
}

/**
 * These tests exercise the HANDLER's chunk/cursor/backoff contract by asserting the EXACT set of
 * `drift_instance_status` rows persisted per pass. Each id-ordered chunk the handler hands to
 * `processBatches` (CONCURRENCY=3) must persist a row for EVERY instance in that chunk and
 * nothing beyond the chunk boundary.
 *
 * Whole-chunk persistence holds because `driftStatusQueries.upsert` is a statement-atomic bare
 * `db.execute` (`INSERT ... ON CONFLICT DO UPDATE`), not a `db.transaction`. A `db.transaction`
 * would issue a nested `BEGIN` on the single shared SQLite connection under the sweep's
 * concurrent `processBatches`, throw "cannot start a transaction within a transaction", and get
 * swallowed by `checkAndPersistInstance` — silently dropping every instance after the first per
 * batch. That defect is fixed; the exact-set assertions below lock in whole-chunk persistence so
 * it can never regress.
 */

// ============================================================================
// Registration
// ============================================================================

Deno.test('drift.check handler is registered in the queue registry', () => {
  const handler = jobQueueRegistry.get('drift.check');
  assertExists(handler, 'drift.check handler should be registered');
});

// ============================================================================
// Chunking + terminal transition (SWEEP_CHUNK_SIZE = 5)
// ============================================================================

migratedTest('drift.check chunks a >5 instance sweep and completes on a later invocation', async () => {
  const handler = getHandler();

  // 8 eligible instances -> first invocation processes 5, second processes remaining 3.
  const ids = seedEnabledInstances(8);
  const firstFive = ids.slice(0, 5);
  const lastThree = ids.slice(5);
  assertEquals(lastThree.length, 3, 'expected 8 instances so the sweep must chunk');

  // ---- Invocation 1: leading chunk, continuation reschedule ----
  const beforeRun1 = Date.now();
  const result1 = await handler(createDriftJob());
  const afterRun1 = Date.now();

  assertEquals(result1.status, 'success');
  assertExists(result1.output);
  assertStringIncludes(result1.output!, '5 instance');
  assertStringIncludes(result1.output!, 'continuing sweep');

  // Continuation reschedules to ~now (yields the runner between chunks).
  assertExists(result1.rescheduleAt);
  const reschedule1Ms = Date.parse(result1.rescheduleAt!);
  assert(
    reschedule1Ms >= beforeRun1 - 1000 && reschedule1Ms <= afterRun1 + 1000,
    `continuation rescheduleAt ${result1.rescheduleAt} should be ~now`
  );

  // The leading id-ordered chunk of 5 was processed IN FULL: the persisted set is exactly the
  // first five, and nothing beyond the chunk boundary was touched.
  const afterRun1Ids = persistedStatusIds();
  assertEquals(afterRun1Ids, firstFive, 'the leading chunk persists a row for every one of its 5 instances');
  for (const id of lastThree) {
    assert(!afterRun1Ids.includes(id), `id ${id} is beyond the chunk boundary and must not be processed yet`);
  }

  // Sweep progress persisted: cursor advanced to the last processed id, sweep in progress.
  const midSettings = driftSettingsQueries.get();
  assertEquals(midSettings.sweep_cursor, firstFive[firstFive.length - 1], 'cursor advances to the 5th id');
  assertExists(midSettings.sweep_started_at);
  assertEquals(midSettings.last_run_at, null, 'sweep not yet complete -> last_run_at untouched');
  const sweepStartedAt = midSettings.sweep_started_at!;
  const interval = midSettings.interval_minutes;

  // ---- Invocation 2: terminal chunk, markRun ----
  const result2 = await handler(createDriftJob());

  assertEquals(result2.status, 'success');
  assertExists(result2.output);
  assertStringIncludes(result2.output!, 'complete');

  // The terminal chunk (ids beyond the run-1 cursor) was processed this pass: the persisted set
  // is now exactly all eight instances (leading five from run 1 + trailing three from run 2).
  const afterRun2Ids = persistedStatusIds();
  assertEquals(afterRun2Ids, ids, 'the completed sweep persists a row for every one of the 8 instances');

  // Terminal transition: last_run_at advanced to the sweep start, cursor + progress reset.
  const finalSettings = driftSettingsQueries.get();
  assertEquals(finalSettings.last_run_at, sweepStartedAt, 'markRun sets last_run_at to the sweep start');
  assertEquals(finalSettings.sweep_cursor, 0, 'markRun resets the cursor');
  assertEquals(finalSettings.sweep_started_at, null, 'markRun clears sweep_started_at');
  assertEquals(finalSettings.error_count, 0);
  assertEquals(finalSettings.backoff_until, null);

  // Terminal reschedule = next interval from the sweep start (not ~now).
  assertExists(result2.rescheduleAt);
  assertEquals(result2.rescheduleAt, calculateNextRunFromMinutes(sweepStartedAt, interval));
});

// ============================================================================
// Cursor-resume: a later invocation with the cursor already set processes only the remainder
// ============================================================================

migratedTest('drift.check resumes from a persisted cursor and processes only the remainder', async () => {
  const handler = getHandler();

  const ids = seedEnabledInstances(7);
  const firstFive = ids.slice(0, 5);
  const remainder = ids.slice(5);

  // Simulate a prior chunk having already processed the first 5: persist the cursor.
  driftSettingsQueries.setSweepProgress(firstFive[firstFive.length - 1], '2026-07-08T00:00:00.000Z');

  const result = await handler(createDriftJob());

  assertEquals(result.status, 'success');
  // Only the remainder is processed this pass; that is the terminal chunk -> complete.
  assertStringIncludes(result.output!, 'complete');

  // The resume pass processes exactly the remainder (ids beyond the cursor) in full, and none of
  // the already-processed leading ids are re-checked.
  const persisted = persistedStatusIds();
  assertEquals(persisted, remainder, 'the resume pass persists a row for every remainder instance and nothing else');
  for (const id of firstFive) {
    assert(!persisted.includes(id), `cursor should skip already-processed id ${id}`);
  }

  const settings = driftSettingsQueries.get();
  assertEquals(settings.last_run_at, '2026-07-08T00:00:00.000Z', 'markRun uses the resumed sweep start');
  assertEquals(settings.sweep_cursor, 0);
  assertEquals(settings.sweep_started_at, null);
});

// ============================================================================
// Disabled settings -> cancelled
// ============================================================================

migratedTest('drift.check returns cancelled when drift detection is disabled', async () => {
  const handler = getHandler();
  seedEnabledInstances(6);

  driftSettingsQueries.update({ enabled: false });

  const result = await handler(createDriftJob());

  assertEquals(result.status, 'cancelled');
  assertStringIncludes(result.decision!, 'disabled');
  // Disabled short-circuits before any instance work.
  assertEquals(persistedStatusIds(), []);
});

// ============================================================================
// Backoff: a handler-body fault increments error_count and grows backoff exponentially
// ============================================================================

migratedTest('drift.check backs off exponentially when the sweep body throws', async () => {
  const handler = getHandler();
  const restores: Restore[] = [];

  // Force a fault inside the handler's try block (getEnabled is called inside it).
  patchTarget(
    arrInstancesQueries,
    'getEnabled',
    (() => {
      throw new Error('db exploded during sweep');
    }) as typeof arrInstancesQueries.getEnabled,
    restores
  );
  // Keep the error log out of the way; the handler awaits it, so no dangling work.
  const logged: string[] = [];
  patchTarget(
    logger,
    'error',
    ((message: string) => {
      logged.push(message);
      return Promise.resolve();
    }) as typeof logger.error,
    restores
  );

  const BASE_MS = 5 * 60 * 1000; // must mirror BACKOFF_BASE_MS in the handler

  try {
    // ---- Failure 1: error_count 0 -> 1, backoff ~= BASE ----
    const before1 = Date.now();
    const result1 = await handler(createDriftJob());

    assertEquals(result1.status, 'failure');
    assert(result1.status === 'failure');
    assertEquals(result1.failureCode, 'database');
    assertExists(result1.rescheduleAt, 'scheduled failures reschedule at the backoff gate');
    assertEquals(logged.length, 1, 'the fault is logged once');

    const settings1 = driftSettingsQueries.get();
    assertEquals(settings1.error_count, 1);
    assertExists(settings1.backoff_until);
    assertEquals(settings1.sweep_cursor, 0, 'markFailure resets sweep progress');
    assertEquals(settings1.sweep_started_at, null);
    // rescheduleAt mirrors the persisted backoff gate.
    assertEquals(result1.rescheduleAt, settings1.backoff_until);

    const delay1 = Date.parse(settings1.backoff_until!) - before1;
    assert(delay1 >= BASE_MS && delay1 <= BASE_MS + 5000, `first backoff delay ${delay1}ms should be ~${BASE_MS}ms`);

    // ---- Failure 2: error_count 1 -> 2, backoff ~= 2 * BASE ----
    const before2 = Date.now();
    const result2 = await handler(createDriftJob());

    assertEquals(result2.status, 'failure');

    const settings2 = driftSettingsQueries.get();
    assertEquals(settings2.error_count, 2, 'error_count keeps climbing across faults');
    assertExists(settings2.backoff_until);

    const delay2 = Date.parse(settings2.backoff_until!) - before2;
    assert(
      delay2 >= 2 * BASE_MS && delay2 <= 2 * BASE_MS + 5000,
      `second backoff delay ${delay2}ms should be ~${2 * BASE_MS}ms (exponential)`
    );

    // Exponential growth: the second window is meaningfully larger than the first.
    assert(delay2 > delay1, 'backoff must grow exponentially between consecutive faults');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
