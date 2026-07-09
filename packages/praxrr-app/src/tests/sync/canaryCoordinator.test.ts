import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import {
  syncHistoryQueries,
  type Pagination,
  type SyncHistoryFilters,
  type SyncHistorySummary,
} from '$db/queries/syncHistory.ts';
import { startRollout } from '$sync/canary/coordinator.ts';
import type { CanaryOutcomeStatus, CanaryStartResult } from '$sync/canary/types.ts';
import type { SyncHistoryInput } from '$sync/syncHistory/types.ts';

// Side-effect import registers the arr.sync section handlers that executeSyncJob
// (invoked inline by the coordinator's canary run) resolves through.
import '$jobs/handlers/arrSync.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so arr_instances / canary_rollouts / canary_settings
 * / sync_history all exist), invoke the test body, then tear the connection down.
 * sanitizeOps/Resources are relaxed because the coordinator fires best-effort
 * notifications (notifyCanaryFailed) and logger writes that outlive the call.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/canary-coordinator-${crypto.randomUUID()}`;
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

function undo(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

/** Insert an enabled arr instance; a random name dodges case-insensitive uniqueness. */
function seedInstance(type: 'radarr' | 'sonarr' | 'lidarr' = 'radarr'): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:1',
    apiKey: 'test-api-key',
  });
}

/**
 * The coordinator imports `executeSyncJob` directly, so it cannot be swapped for a
 * spy. Instead we intercept the single unavoidable DB read INSIDE executeSyncJob —
 * `arrInstancesQueries.getById(instanceId)` (arrSync.ts:307) — to (a) count canary /
 * remaining sync attempts by id and (b) return an `enabled: 0` clone so the sync
 * short-circuits to `cancelled` immediately (arrSync.ts:308) with no network, no
 * audit-row write, and no side effects. The canary's classification is driven
 * independently through the patched `syncHistoryQueries.search` seam below, so the
 * `cancelled` return only matters on the no-row fallback paths.
 *
 * getById is NOT called by resolveCanary's auto-select/default paths (those read
 * getEnabled), so the count equals the number of executeSyncJob / preview attempts.
 */
function installGetByIdProbe(restores: Restore[]): Map<number, number> {
  const calls = new Map<number, number>();
  const original = arrInstancesQueries.getById;
  arrInstancesQueries.getById = (id: number): ArrInstance | undefined => {
    calls.set(id, (calls.get(id) ?? 0) + 1);
    const row = original(id);
    return row ? ({ ...row, enabled: 0 } as ArrInstance) : row;
  };
  restores.push(() => {
    arrInstancesQueries.getById = original;
  });
  return calls;
}

/** Recorded `search` invocations so tests can assert the from-bounded, instance-scoped read. */
interface CapturedSearch {
  filters: SyncHistoryFilters;
  page: Pagination;
}

/**
 * Replace `syncHistoryQueries.search` — the coordinator's classification read — with a
 * canned result so every CanaryOutcomeStatus is deterministic without exercising the
 * whole Arr sync + recorder pipeline. Returns the captured calls for from-bound / scope
 * assertions.
 */
function stubClassificationSearch(restores: Restore[], rows: SyncHistorySummary[]): CapturedSearch[] {
  const captured: CapturedSearch[] = [];
  const original = syncHistoryQueries.search;
  syncHistoryQueries.search = (filters: SyncHistoryFilters, page: Pagination): SyncHistorySummary[] => {
    captured.push({ filters, page });
    return rows;
  };
  restores.push(() => {
    syncHistoryQueries.search = original;
  });
  return captured;
}

/**
 * Insert a REAL sync_history row for the canary so `canary_sync_history_id`
 * (FK -> sync_history.id) is satisfiable when the classifier trusts the row. Returns
 * the new row id, which the stubbed search then surfaces to the coordinator.
 */
function seedHistoryRow(instanceId: number, status: SyncHistoryInput['status']): number {
  const input: SyncHistoryInput = {
    arrInstanceId: instanceId,
    instanceName: 'Canary',
    arrType: 'radarr',
    jobId: null,
    trigger: 'manual',
    triggerEvent: null,
    sectionsAttempted: ['qualityProfiles'],
    status,
    sectionsRun: 1,
    itemsSynced: 0,
    failureCount: status === 'failed' || status === 'partial' ? 1 : 0,
    sectionResults: [],
    changes: [],
    error: null,
    startedAt: '2026-07-09T10:00:00.000Z',
    finishedAt: '2026-07-09T10:00:01.000Z',
    durationMs: 1000,
  };
  return syncHistoryQueries.insert(input);
}

/** A complete SyncHistorySummary with overridable classification-relevant fields. */
function makeSummary(overrides: Partial<SyncHistorySummary>): SyncHistorySummary {
  return {
    id: 777,
    arrInstanceId: 0,
    instanceName: 'Canary',
    arrType: 'radarr',
    jobId: null,
    trigger: 'manual',
    triggerEvent: null,
    sectionsAttempted: [],
    status: 'success',
    sectionsRun: 0,
    itemsSynced: 0,
    failureCount: 0,
    entityChangeCount: 0,
    error: null,
    startedAt: '2026-07-09T10:00:00.000Z',
    finishedAt: '2026-07-09T10:00:01.000Z',
    durationMs: 1000,
    createdAt: '2026-07-09T10:00:01.000Z',
    ...overrides,
  };
}

/** Narrow a start result to the gate (non-skipped) arm or fail the test. */
function expectGate(result: CanaryStartResult): Extract<CanaryStartResult, { skipped: false }> {
  if (result.skipped) {
    throw new Error('expected a staged (non-skipped) rollout result');
  }
  return result;
}

/**
 * Pin the resolved canary to a specific instance without the explicit-id path (which
 * reads getById and would see the probe's disabled clone). The default-canary path
 * resolves from the getEnabled cohort, so it is unaffected by the getById probe.
 */
function pinDefaultCanary(instanceId: number): void {
  canarySettingsQueries.update({ defaultCanaryInstanceId: instanceId, autoSelect: true });
}

// ---------------------------------------------------------------------------
// Auto-skip: a single eligible target runs a normal sync, no rollout row
// ---------------------------------------------------------------------------

migratedTest('startRollout auto-skips a single-eligible cohort: one executeSyncJob call, no rollout row', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  const calls = installGetByIdProbe(restores);
  const search = stubClassificationSearch(restores, []);

  try {
    const result = await startRollout({ arrType: 'radarr' });

    // Skip arm: a normal sync result, never the staged gate shape.
    assert(result.skipped, 'single-eligible cohort must auto-skip');
    assertExists(result.result);

    // executeSyncJob ran exactly once, for the canary.
    assertEquals(calls.get(canaryId), 1);
    // Auto-skip returns before any classification read.
    assertEquals(search.length, 0);
    // No rollout row is opened on the skip path.
    assertEquals(canaryRolloutQueries.listRecent(50, 0).length, 0);
  } finally {
    undo(restores);
  }
});

// ---------------------------------------------------------------------------
// Gate matrix
// ---------------------------------------------------------------------------

migratedTest('gate matrix: a failed canary aborts and never dispatches the remaining instances', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  const remainingId = seedInstance('radarr');
  pinDefaultCanary(canaryId);
  const histId = seedHistoryRow(canaryId, 'failed');
  const calls = installGetByIdProbe(restores);
  const search = stubClassificationSearch(restores, [
    makeSummary({ id: histId, arrInstanceId: canaryId, status: 'failed' }),
  ]);

  try {
    const result = expectGate(await startRollout({ arrType: 'radarr' }));

    assertEquals(result.rollout.status, 'aborted');
    assertEquals(result.rollout.canaryStatus, 'failed');
    assertEquals(result.rollout.canarySyncHistoryId, histId);
    // Fail-closed: no preview, and the remaining instance is never synced/previewed.
    assertEquals(result.remainingPreview, []);
    assertEquals(calls.get(canaryId), 1, 'only the canary sync ran');
    assertEquals(calls.get(remainingId), undefined, 'remaining instance must not be dispatched on abort');

    // Classification read was scoped to the canary and bounded by a `from` timestamp.
    assertEquals(search.length, 1);
    assertEquals(search[0].filters.instanceId, canaryId);
    assert(typeof search[0].filters.from === 'string', 'classification must use the from:now bound');
  } finally {
    undo(restores);
  }
});

migratedTest(
  'gate matrix: a successful canary halts at awaiting_confirmation and builds the remaining preview',
  async () => {
    const restores: Restore[] = [];
    const canaryId = seedInstance('radarr');
    const remainingId = seedInstance('radarr');
    pinDefaultCanary(canaryId);
    const histId = seedHistoryRow(canaryId, 'success');
    const calls = installGetByIdProbe(restores);
    stubClassificationSearch(restores, [makeSummary({ id: histId, arrInstanceId: canaryId, status: 'success' })]);

    try {
      const result = expectGate(await startRollout({ arrType: 'radarr' }));

      assertEquals(result.rollout.status, 'awaiting_confirmation');
      assertEquals(result.rollout.canaryStatus, 'success');
      assertEquals(result.rollout.canarySyncHistoryId, histId);
      // The preview-build path is taken (distinct from abort's hard-coded []): the remaining
      // instance is read for previewing. Content is [] only because the offline Arr client
      // cannot generate a live diff in a unit test — asserting the array shape is enough here.
      assert(Array.isArray(result.remainingPreview));
      assert((calls.get(remainingId) ?? 0) >= 1, 'buildRemainingPreview must reach the remaining instance');
    } finally {
      undo(restores);
    }
  }
);

migratedTest('gate matrix: a partial canary under the gate policy halts at awaiting_confirmation', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  seedInstance('radarr');
  pinDefaultCanary(canaryId);
  const histId = seedHistoryRow(canaryId, 'partial');
  installGetByIdProbe(restores);
  // Default partial_policy is 'gate' (migration default).
  stubClassificationSearch(restores, [makeSummary({ id: histId, arrInstanceId: canaryId, status: 'partial' })]);

  try {
    const result = expectGate(await startRollout({ arrType: 'radarr' }));

    // Precise `partial` classification carried straight from the recorded row.
    assertEquals(result.rollout.status, 'awaiting_confirmation');
    assertEquals(result.rollout.canaryStatus, 'partial');
    assertEquals(result.rollout.canarySyncHistoryId, histId);
  } finally {
    undo(restores);
  }
});

migratedTest('gate matrix: a partial canary under the abort policy aborts fail-closed', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  const remainingId = seedInstance('radarr');
  pinDefaultCanary(canaryId);
  const histId = seedHistoryRow(canaryId, 'partial');
  const calls = installGetByIdProbe(restores);
  stubClassificationSearch(restores, [makeSummary({ id: histId, arrInstanceId: canaryId, status: 'partial' })]);

  try {
    const result = expectGate(await startRollout({ arrType: 'radarr', partialPolicy: 'abort' }));

    assertEquals(result.rollout.status, 'aborted');
    assertEquals(result.rollout.canaryStatus, 'partial');
    assertEquals(result.remainingPreview, []);
    assertEquals(calls.get(remainingId), undefined, 'remaining instance is not previewed on abort');
  } finally {
    undo(restores);
  }
});

migratedTest('gate matrix: a skipped canary aborts fail-closed', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  seedInstance('radarr');
  pinDefaultCanary(canaryId);
  const histId = seedHistoryRow(canaryId, 'skipped');
  installGetByIdProbe(restores);
  stubClassificationSearch(restores, [makeSummary({ id: histId, arrInstanceId: canaryId, status: 'skipped' })]);

  try {
    const result = expectGate(await startRollout({ arrType: 'radarr' }));

    assertEquals(result.rollout.status, 'aborted');
    assertEquals(result.rollout.canaryStatus, 'skipped');
    assertEquals(result.remainingPreview, []);
  } finally {
    undo(restores);
  }
});

// ---------------------------------------------------------------------------
// Classification edge cases
// ---------------------------------------------------------------------------

migratedTest('classification no-row fallback maps the JobRunStatus and never upgrades to success', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  seedInstance('radarr');
  pinDefaultCanary(canaryId);
  installGetByIdProbe(restores); // canary sync short-circuits to `cancelled`
  const search = stubClassificationSearch(restores, []); // no bounded audit row

  try {
    const result = expectGate(await startRollout({ arrType: 'radarr' }));

    // No row -> conservative JobRunStatus mapping (cancelled -> failed). NEVER success.
    const status: CanaryOutcomeStatus | null = result.rollout.canaryStatus;
    assert(status !== 'success', 'a missing audit row must never classify as success');
    assertEquals(status, 'failed');
    assertEquals(result.rollout.status, 'aborted');
    // No trusted row -> no linked diagnostics id.
    assertEquals(result.rollout.canarySyncHistoryId, null);
    // The bounded read still happened (from:now), it simply returned nothing.
    assertEquals(search.length, 1);
    assert(typeof search[0].filters.from === 'string');
  } finally {
    undo(restores);
  }
});

migratedTest('classification rejects a foreign-instance row (asserts row.arrInstanceId === canaryId)', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  seedInstance('radarr');
  pinDefaultCanary(canaryId);
  installGetByIdProbe(restores);
  // A newest row that belongs to a DIFFERENT instance but reports success — the classifier
  // must not trust it. Falls through to the JobRunStatus mapping instead.
  const search = stubClassificationSearch(restores, [
    makeSummary({ id: 999, arrInstanceId: canaryId + 5000, status: 'success' }),
  ]);

  try {
    const result = expectGate(await startRollout({ arrType: 'radarr' }));

    assert(result.rollout.canaryStatus !== 'success', 'a foreign-instance row must not classify the canary');
    assertEquals(result.rollout.canaryStatus, 'failed');
    assertEquals(result.rollout.canarySyncHistoryId, null);
    assertEquals(result.rollout.status, 'aborted');
    assertEquals(search[0].filters.instanceId, canaryId);
  } finally {
    undo(restores);
  }
});

// ---------------------------------------------------------------------------
// Preview resilience: a remaining instance disabled mid-gate degrades to []
// ---------------------------------------------------------------------------

migratedTest(
  'a remaining instance disabled between selection and preview degrades to [] without throwing',
  async () => {
    const restores: Restore[] = [];
    const canaryId = seedInstance('radarr');
    const remainingId = seedInstance('radarr');
    pinDefaultCanary(canaryId);

    // Capture the real enabled rows before patching so the stateful getEnabled can replay them.
    const enabledRows = arrInstancesQueries.getEnabled();
    const canaryRow = enabledRows.find((row) => row.id === canaryId)!;
    const remainingRow = enabledRows.find((row) => row.id === remainingId)!;

    const histId = seedHistoryRow(canaryId, 'success');
    const calls = installGetByIdProbe(restores);
    stubClassificationSearch(restores, [makeSummary({ id: histId, arrInstanceId: canaryId, status: 'success' })]);

    // getEnabled call #1 (resolveCanary) sees both; call #2 (buildRemainingPreview) sees the
    // remaining instance already gone — simulating a mid-gate disable/delete.
    let getEnabledCalls = 0;
    const originalGetEnabled = arrInstancesQueries.getEnabled;
    arrInstancesQueries.getEnabled = (): ArrInstance[] => {
      getEnabledCalls += 1;
      return getEnabledCalls <= 1 ? [canaryRow, remainingRow] : [canaryRow];
    };
    restores.push(() => {
      arrInstancesQueries.getEnabled = originalGetEnabled;
    });

    try {
      // Must not 500: the rollout still halts at the gate with an empty preview.
      const result = expectGate(await startRollout({ arrType: 'radarr' }));

      assertEquals(result.rollout.status, 'awaiting_confirmation');
      assertEquals(result.remainingPreview, []);
      // The re-filter dropped the disabled remaining BEFORE any preview generation, so its
      // getById is never reached during the preview build.
      assertEquals(calls.get(remainingId), undefined, 'disabled remaining must be filtered before previewing');
      assertEquals(getEnabledCalls, 2, 'getEnabled is re-read immediately before the preview build');
    } finally {
      undo(restores);
    }
  }
);
