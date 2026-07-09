import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries, type InsertCanaryRolloutInput } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import type { CanaryInstanceResult, CanaryTarget } from '$sync/canary/types.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so migration 20260714 creates canary_rollouts /
 * canary_settings and seeds the settings singleton), invoke the test body, then
 * tear the connection down. Mirrors syncHistoryQueries.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/canary-queries-${crypto.randomUUID()}`;
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

/** A random name dodges case-insensitive uniqueness across seeds. */
function seedInstance(type: 'radarr' | 'sonarr' | 'lidarr' = 'radarr'): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
}

/** Open a rollout in `canary_running` state with deterministic defaults + explicit token. */
function insertRollout(overrides: Partial<InsertCanaryRolloutInput> = {}): number {
  return canaryRolloutQueries.insert({
    arrType: 'radarr',
    canaryInstanceId: null,
    canaryInstanceName: 'Canary Radarr',
    sections: ['qualityProfiles', 'mediaManagement'],
    maxBatchSize: 1,
    partialPolicy: 'gate',
    remainingTargets: [{ instanceId: 11, instanceName: 'Radarr B' }],
    trigger: 'manual',
    startedAt: '2026-07-08T10:00:00.000Z',
    stateToken: 'tok-initial',
    ...overrides,
  });
}

/** Drive a rollout into `awaiting_confirmation`, re-issuing `state_token` to `gateToken`. */
function moveToGate(id: number, gateToken: string): void {
  const advanced = canaryRolloutQueries.recordCanaryOutcome(id, {
    status: 'awaiting_confirmation',
    canaryStatus: 'success',
    canaryOutput: 'canary ok',
    canaryError: null,
    canarySyncHistoryId: null,
    nextToken: gateToken,
    finishedAt: null,
  });
  assert(advanced, 'expected recordCanaryOutcome to advance the canary_running rollout');
}

// ---------------------------------------------------------------------------
// canaryRolloutQueries: insert + getById round-trip
// ---------------------------------------------------------------------------

migratedTest('insert then getById round-trips every field incl. decoded JSON blobs', () => {
  const targets: CanaryTarget[] = [
    { instanceId: 21, instanceName: 'Radarr B' },
    { instanceId: 22, instanceName: 'Radarr C' },
  ];
  const id = insertRollout({
    sections: ['qualityProfiles', 'mediaManagement'],
    remainingTargets: targets,
    maxBatchSize: 2,
    partialPolicy: 'abort',
    trigger: 'manual',
    startedAt: '2026-07-08T10:00:00.000Z',
    stateToken: 'tok-rt',
  });
  assert(id > 0);

  const detail = canaryRolloutQueries.getById(id);
  assertExists(detail);
  assertEquals(detail.id, id);
  assertEquals(detail.arrType, 'radarr');
  assertEquals(detail.status, 'canary_running');
  assertEquals(detail.canaryInstanceId, null);
  assertEquals(detail.canaryInstanceName, 'Canary Radarr');
  assertEquals(detail.canaryStatus, null);
  assertEquals(detail.canarySyncHistoryId, null);
  assertEquals(detail.sections, ['qualityProfiles', 'mediaManagement']);
  assertEquals(detail.maxBatchSize, 2);
  assertEquals(detail.partialPolicy, 'abort');
  assertEquals(detail.canaryOutput, null);
  assertEquals(detail.canaryError, null);
  // The JSON blobs decode back to the exact structures we wrote.
  assertEquals(detail.remainingTargets, targets);
  assertEquals(detail.batchCursor, 0);
  assertEquals(detail.rolloutResults, []);
  assertEquals(detail.trigger, 'manual');
  assertEquals(detail.startedAt, '2026-07-08T10:00:00.000Z');
  assertEquals(detail.finishedAt, null);
  assertEquals(detail.stateToken, 'tok-rt');
});

migratedTest('insert stores sections as NULL when provided as null', () => {
  const id = insertRollout({ sections: null });
  assertEquals(canaryRolloutQueries.getById(id)?.sections, null);
});

migratedTest('getById returns undefined for an unknown id', () => {
  assert(canaryRolloutQueries.getById(999_999) === undefined);
});

// ---------------------------------------------------------------------------
// listRecent: newest-first, summary projection omits the heavy/secret fields
// ---------------------------------------------------------------------------

migratedTest('listRecent returns summaries newest-first and derives remaining/completed counts', () => {
  const idOld = insertRollout({
    startedAt: '2026-07-01T10:00:00.000Z',
    remainingTargets: [
      { instanceId: 1, instanceName: 'A' },
      { instanceId: 2, instanceName: 'B' },
    ],
    stateToken: 'tok-old',
  });
  const idNew = insertRollout({
    startedAt: '2026-07-05T10:00:00.000Z',
    remainingTargets: [{ instanceId: 3, instanceName: 'C' }],
    stateToken: 'tok-new',
  });

  const rows = canaryRolloutQueries.listRecent(10, 0);
  assertEquals(
    rows.map((r) => r.id),
    [idNew, idOld]
  );

  // Summary projection never leaks the state token or the heavy blobs.
  assert(!Object.hasOwn(rows[0], 'stateToken'), 'summary must not expose stateToken');
  assert(!Object.hasOwn(rows[0], 'remainingTargets'), 'summary must not expose remainingTargets');
  assert(!Object.hasOwn(rows[0], 'sections'), 'summary must not expose sections');

  // Counts derive from the array lengths.
  assertEquals(rows[0].remainingCount, 1);
  assertEquals(rows[1].remainingCount, 2);
  assertEquals(rows[0].completedCount, 0);

  // Pagination is stable (newest-first, id tiebreak).
  assertEquals(
    canaryRolloutQueries.listRecent(1, 0).map((r) => r.id),
    [idNew]
  );
  assertEquals(
    canaryRolloutQueries.listRecent(1, 1).map((r) => r.id),
    [idOld]
  );
});

// ---------------------------------------------------------------------------
// Guarded mutators: recordCanaryOutcome / markRollingOut / abort /
// recordBatchProgress / finishRollout — status + token value guards
// ---------------------------------------------------------------------------

migratedTest('recordCanaryOutcome is guarded to canary_running and re-issues the state token', () => {
  const id = insertRollout();
  const before = canaryRolloutQueries.getById(id);
  assertExists(before);
  assertEquals(before.status, 'canary_running');
  assertEquals(before.stateToken, 'tok-initial');

  const advanced = canaryRolloutQueries.recordCanaryOutcome(id, {
    status: 'awaiting_confirmation',
    canaryStatus: 'partial',
    canaryOutput: '2 item(s)',
    canaryError: null,
    canarySyncHistoryId: null,
    nextToken: 'tok-gate',
    finishedAt: null,
  });
  assert(advanced);

  const after = canaryRolloutQueries.getById(id);
  assertExists(after);
  assertEquals(after.status, 'awaiting_confirmation');
  assertEquals(after.canaryStatus, 'partial');
  assertEquals(after.canaryOutput, '2 item(s)');
  // The pre-canary token can no longer authorize a proceed.
  assertEquals(after.stateToken, 'tok-gate');

  // A second call is rejected — the rollout is no longer canary_running.
  const second = canaryRolloutQueries.recordCanaryOutcome(id, {
    status: 'failed',
    canaryStatus: 'failed',
    canaryOutput: null,
    canaryError: 'late',
    canarySyncHistoryId: null,
    nextToken: 'tok-late',
    finishedAt: '2026-07-08T11:00:00.000Z',
  });
  assertEquals(second, false);
  assertEquals(canaryRolloutQueries.getById(id)?.status, 'awaiting_confirmation');
});

migratedTest('markRollingOut rejects a stale token and a wrong status, else advances + re-issues', () => {
  const id = insertRollout();
  moveToGate(id, 'tok-gate');

  // Wrong token -> no transition (the real double-proceed guard).
  assertEquals(canaryRolloutQueries.markRollingOut(id, 'wrong-token', 'tok-next'), false);
  assertEquals(canaryRolloutQueries.getById(id)?.status, 'awaiting_confirmation');

  // Correct token -> rolling_out, token re-issued.
  assertEquals(canaryRolloutQueries.markRollingOut(id, 'tok-gate', 'tok-next'), true);
  const advanced = canaryRolloutQueries.getById(id);
  assertExists(advanced);
  assertEquals(advanced.status, 'rolling_out');
  assertEquals(advanced.stateToken, 'tok-next');

  // Replaying the same proceed is rejected — no longer awaiting_confirmation.
  assertEquals(canaryRolloutQueries.markRollingOut(id, 'tok-next', 'tok-again'), false);
});

migratedTest('abort rejects a stale token and a wrong status, else aborts with finished_at', () => {
  const id = insertRollout();
  moveToGate(id, 'tok-gate');

  assertEquals(canaryRolloutQueries.abort(id, 'wrong-token', '2026-07-08T11:00:00.000Z'), false);
  assertEquals(canaryRolloutQueries.getById(id)?.status, 'awaiting_confirmation');

  assertEquals(canaryRolloutQueries.abort(id, 'tok-gate', '2026-07-08T11:00:00.000Z'), true);
  const aborted = canaryRolloutQueries.getById(id);
  assertExists(aborted);
  assertEquals(aborted.status, 'aborted');
  assertEquals(aborted.finishedAt, '2026-07-08T11:00:00.000Z');

  // A proceed after abort cannot resurrect the terminal row.
  assertEquals(canaryRolloutQueries.markRollingOut(id, 'tok-gate', 'tok-x'), false);
});

migratedTest('recordBatchProgress + finishRollout are guarded to rolling_out', () => {
  const results: CanaryInstanceResult[] = [{ instanceId: 31, instanceName: 'A', status: 'success', output: 'ok' }];
  const id = insertRollout({ maxBatchSize: 3 });

  // Guarded: neither progress nor finish applies while still canary_running.
  assertEquals(canaryRolloutQueries.recordBatchProgress(id, 1, results), false);
  assertEquals(canaryRolloutQueries.finishRollout(id, 'completed', '2026-07-08T11:00:00.000Z'), false);

  moveToGate(id, 'tok-gate');
  assertEquals(canaryRolloutQueries.markRollingOut(id, 'tok-gate', 'tok-run'), true);

  // Now rolling_out: progress persists cursor + results.
  assert(canaryRolloutQueries.recordBatchProgress(id, 1, results));
  const mid = canaryRolloutQueries.getById(id);
  assertExists(mid);
  assertEquals(mid.batchCursor, 1);
  assertEquals(mid.rolloutResults, results);

  // Terminal transition.
  assert(canaryRolloutQueries.finishRollout(id, 'completed', '2026-07-08T12:00:00.000Z'));
  const done = canaryRolloutQueries.getById(id);
  assertExists(done);
  assertEquals(done.status, 'completed');
  assertEquals(done.finishedAt, '2026-07-08T12:00:00.000Z');

  // Post-terminal writes are rejected.
  assertEquals(canaryRolloutQueries.finishRollout(id, 'failed', '2026-07-08T13:00:00.000Z'), false);
  assertEquals(canaryRolloutQueries.recordBatchProgress(id, 2, results), false);
});

// ---------------------------------------------------------------------------
// canarySettingsQueries: seeded singleton + patch round-trip
// ---------------------------------------------------------------------------

migratedTest('get returns the seeded singleton with fail-closed defaults', () => {
  const settings = canarySettingsQueries.get();
  assertEquals(settings.enabled, false);
  assertEquals(settings.defaultMaxBatchSize, 1);
  assertEquals(settings.autoSelect, true);
  assertEquals(settings.defaultCanaryInstanceId, null);
  assertEquals(settings.defaultPartialPolicy, 'gate');
});

migratedTest('update round-trips every field (INTEGER flags <-> booleans) and persists', () => {
  const instanceId = seedInstance('radarr');

  const updated = canarySettingsQueries.update({
    enabled: true,
    defaultMaxBatchSize: 5,
    autoSelect: false,
    defaultCanaryInstanceId: instanceId,
    defaultPartialPolicy: 'abort',
  });
  assertEquals(updated.enabled, true);
  assertEquals(updated.defaultMaxBatchSize, 5);
  assertEquals(updated.autoSelect, false);
  assertEquals(updated.defaultCanaryInstanceId, instanceId);
  assertEquals(updated.defaultPartialPolicy, 'abort');

  // Persisted across a fresh read.
  const reread = canarySettingsQueries.get();
  assertEquals(reread.enabled, true);
  assertEquals(reread.defaultCanaryInstanceId, instanceId);
  assertEquals(reread.defaultPartialPolicy, 'abort');

  // A partial update leaves untouched fields intact.
  const partial = canarySettingsQueries.update({ enabled: false });
  assertEquals(partial.enabled, false);
  assertEquals(partial.defaultMaxBatchSize, 5);
  assertEquals(partial.autoSelect, false);
  assertEquals(partial.defaultPartialPolicy, 'abort');

  // Clearing the default canary instance is an explicit null (not "leave alone").
  const cleared = canarySettingsQueries.update({ defaultCanaryInstanceId: null });
  assertEquals(cleared.defaultCanaryInstanceId, null);
});
