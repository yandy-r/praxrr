import { assert, assertEquals, assertExists, assertRejects, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { type ArrInstance, arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import {
  type Pagination,
  type SyncHistoryFilters,
  type SyncHistorySummary,
  syncHistoryQueries,
} from '$db/queries/syncHistory.ts';
import { HttpError } from '$http/types.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { logger } from '$logger/logger.ts';
import { abortRollout, buildRemainingPreviewEvidence, proceedRollout, startRollout } from '$sync/canary/coordinator.ts';
import { CanaryPreviewUnavailableError, CanaryStaleTokenError, CanaryStateError } from '$sync/canary/errors.ts';
import type {
  CanaryOutcomeStatus,
  CanaryRemainingPreviewEvidence,
  CanaryStartResult,
  CanaryTarget,
} from '$sync/canary/types.ts';
import { buildPreviewFailure } from '$sync/preview/failureReason.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
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
        jobDispatcher.stop();
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
    entityOutcomes: [],
    previewId: null,
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
    entityOutcomeCount: 0,
    previewId: null,
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
  canarySettingsQueries.update({
    defaultCanaryInstanceId: instanceId,
    autoSelect: true,
  });
}

function targetFor(instanceId: number): CanaryTarget {
  const instance = arrInstancesQueries.getById(instanceId);
  assertExists(instance);
  return { instanceId, instanceName: instance.name };
}

function zeroChangePreview(
  target: CanaryTarget,
  arrType: 'radarr' | 'sonarr' | 'lidarr' = 'radarr',
  sectionFailure = false
): GeneratePreviewResult {
  const failure = sectionFailure ? buildPreviewFailure('unauthorized', arrType) : null;
  return {
    instanceId: target.instanceId,
    instanceName: target.instanceName,
    arrType,
    status: 'ready',
    createdAtMs: 1_783_510_400_000,
    sections: ['qualityProfiles'],
    sectionOutcomes: [{ section: 'qualityProfiles', failure, skipped: false }],
    qualityProfiles: failure ? null : { section: 'qualityProfiles', customFormats: [], qualityProfiles: [] },
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: {
      totalCreates: 0,
      totalUpdates: 0,
      totalDeletes: 0,
      totalUnchanged: 0,
    },
  };
}

function availableEvidence(target: CanaryTarget): CanaryRemainingPreviewEvidence {
  return {
    version: 1,
    availability: 'available',
    generatedAt: '2026-07-09T10:01:00.000Z',
    previews: [zeroChangePreview(target)],
  };
}

function unavailableEvidence(target: CanaryTarget): CanaryRemainingPreviewEvidence {
  return {
    version: 1,
    availability: 'unavailable',
    generatedAt: '2026-07-09T10:01:00.000Z',
    failure: buildPreviewFailure('unreachable', 'radarr'),
    partialPreviews: [zeroChangePreview(target)],
  };
}

function insertGate(evidence: CanaryRemainingPreviewEvidence): {
  id: number;
  token: string;
} {
  const target = evidence.availability === 'available' ? evidence.previews[0] : evidence.partialPreviews[0];
  const id = canaryRolloutQueries.insert({
    arrType: 'radarr',
    canaryInstanceId: null,
    canaryInstanceName: 'Canary',
    sections: ['qualityProfiles'],
    maxBatchSize: 1,
    partialPolicy: 'gate',
    remainingTargets: [{ instanceId: target.instanceId, instanceName: target.instanceName }],
    trigger: 'manual',
    startedAt: '2026-07-09T10:00:00.000Z',
    stateToken: 'initial',
  });
  const token = `gate-${id}`;
  assert(
    canaryRolloutQueries.recordCanaryOutcome(id, {
      status: 'awaiting_confirmation',
      canaryStatus: 'success',
      canaryOutput: 'ok',
      canaryError: null,
      canarySyncHistoryId: null,
      remainingPreview: evidence,
      nextToken: token,
      finishedAt: null,
    })
  );
  return { id, token };
}

function queuedCanaryJobs(): number {
  return (
    db.queryFirst<{ total: number }>("SELECT COUNT(*) AS total FROM job_queue WHERE job_type = 'sync.canary.rollout'")
      ?.total ?? 0
  );
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
    // Fail-closed: no remaining target is synced/previewed.
    assertEquals(result.rollout.remainingPreview.availability, 'unavailable');
    assertEquals(calls.get(canaryId), 1, 'only the canary sync ran');
    assertEquals(calls.get(remainingId), undefined, 'remaining instance must not be dispatched on abort');

    // Classification read was scoped to the canary, bounded by a `from` timestamp, and
    // restricted to `trigger: 'manual'` so a concurrently-dispatched schedule/system sync
    // of the same instance cannot win the newest-row ordering and mis-classify the canary.
    assertEquals(search.length, 1);
    assertEquals(search[0].filters.instanceId, canaryId);
    assert(typeof search[0].filters.from === 'string', 'classification must use the from:now bound');
    assertEquals(search[0].filters.trigger, 'manual', 'classification must scope to trigger=manual');
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
      // The preview-build path is taken. The offline probe makes generation unavailable,
      // which is now explicit rather than an ambiguous empty array.
      assertEquals(result.rollout.remainingPreview.availability, 'unavailable');
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
    assertEquals(result.rollout.remainingPreview.availability, 'unavailable');
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
    assertEquals(result.rollout.remainingPreview.availability, 'unavailable');
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
    makeSummary({
      id: 999,
      arrInstanceId: canaryId + 5000,
      status: 'success',
    }),
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
// Preview resilience: target drift becomes explicit unavailable evidence
// ---------------------------------------------------------------------------

migratedTest(
  'a remaining instance disabled between selection and preview becomes unavailable without throwing',
  async () => {
    const restores: Restore[] = [];
    const canaryId = seedInstance('radarr');
    const remainingId = seedInstance('radarr');
    pinDefaultCanary(canaryId);

    // Capture the real enabled rows before patching so the stateful getEnabled can replay them.
    const enabledRows = arrInstancesQueries.getEnabled();
    const canaryRow = enabledRows.find((row) => row.id === canaryId);
    const remainingRow = enabledRows.find((row) => row.id === remainingId);
    assertExists(canaryRow);
    assertExists(remainingRow);

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
      // Must not 500: the rollout still halts at the gate with unavailable evidence.
      const result = expectGate(await startRollout({ arrType: 'radarr' }));

      assertEquals(result.rollout.status, 'awaiting_confirmation');
      assertEquals(result.rollout.remainingPreview.availability, 'unavailable');
      // The re-filter dropped the disabled remaining BEFORE any preview generation, so its
      // getById is never reached during the preview build.
      assertEquals(calls.get(remainingId), undefined, 'disabled remaining must be filtered before previewing');
      assertEquals(getEnabledCalls, 2, 'getEnabled is re-read immediately before the preview build');
    } finally {
      undo(restores);
    }
  }
);

// ---------------------------------------------------------------------------
// Remaining-preview evidence and promotion authorization
// ---------------------------------------------------------------------------

migratedTest('evidence builder distinguishes complete zero-change from partial section failure', async () => {
  const remainingId = seedInstance('radarr');
  const target = targetFor(remainingId);

  const available = await buildRemainingPreviewEvidence('radarr', [target], ['qualityProfiles'], (requests) => {
    assertEquals(
      requests.map((request) => request.instanceId),
      [remainingId]
    );
    return Promise.resolve([zeroChangePreview(target)]);
  });
  assertEquals(available.availability, 'available');
  if (available.availability === 'available') {
    assertEquals(available.previews[0].summary.totalCreates, 0);
  }

  const partial = await buildRemainingPreviewEvidence('radarr', [target], ['qualityProfiles'], () =>
    Promise.resolve([zeroChangePreview(target, 'radarr', true)])
  );
  assertEquals(partial.availability, 'unavailable');
  if (partial.availability === 'unavailable') {
    assertEquals(partial.failure.code, 'sectionErrors');
    assertEquals(partial.partialPreviews.length, 1);
  }
});

migratedTest('evidence builder classifies unreachable/unauthorized safely and sanitizes logger metadata', async () => {
  const remainingId = seedInstance('radarr');
  const target = targetFor(remainingId);
  const secretKey = '0123456789abcdef0123456789abcdef';
  const secretUrl = `http://arr.invalid/api?apikey=${secretKey}`;
  const captured: Array<{ message: string; options: unknown }> = [];
  const originalError = logger.error;
  logger.error = (message, options) => {
    captured.push({ message, options });
    return Promise.resolve();
  };

  try {
    for (const [status, code] of [
      [0, 'unreachable'],
      [401, 'unauthorized'],
    ] as const) {
      const evidence = await buildRemainingPreviewEvidence('radarr', [target], null, () =>
        Promise.reject(new HttpError(`${secretUrl} Authorization: Bearer ${secretKey}`, status, { secretKey }))
      );
      assertEquals(evidence.availability, 'unavailable');
      if (evidence.availability === 'unavailable') assertEquals(evidence.failure.code, code);
    }

    const logged = JSON.stringify(captured);
    assertEquals(
      captured.every((entry) => entry.message === 'Canary remaining-target preview generation failed'),
      true
    );
    assert(!logged.includes(secretKey));
    assert(!logged.includes(secretUrl));
    assert(!logged.includes(`Bearer ${secretKey}`));
  } finally {
    logger.error = originalError;
  }
});

migratedTest('evidence builder rejects missing and cross-Arr targets without invoking generation', async () => {
  const sonarrId = seedInstance('sonarr');
  const target = targetFor(sonarrId);
  let generated = false;
  const evidence = await buildRemainingPreviewEvidence('radarr', [target], null, () => {
    generated = true;
    return Promise.resolve([]);
  });
  assertEquals(evidence.availability, 'unavailable');
  assertEquals(generated, false);
});

migratedTest('proceed requires available exact evidence; unavailable/null/corrupt evidence enqueue nothing', () => {
  const target = { instanceId: 901, instanceName: 'Remaining' };

  const unavailable = insertGate(unavailableEvidence(target));
  assertThrows(() => proceedRollout(unavailable.id, unavailable.token), CanaryPreviewUnavailableError);

  const legacy = insertGate(availableEvidence(target));
  db.execute('UPDATE canary_rollouts SET remaining_preview_evidence = NULL WHERE id = ?', legacy.id);
  assertThrows(() => proceedRollout(legacy.id, legacy.token), CanaryPreviewUnavailableError);

  const corrupt = insertGate(availableEvidence(target));
  db.execute("UPDATE canary_rollouts SET remaining_preview_evidence = '{bad' WHERE id = ?", corrupt.id);
  assertThrows(() => proceedRollout(corrupt.id, corrupt.token), CanaryPreviewUnavailableError);
  assertEquals(queuedCanaryJobs(), 0);
});

migratedTest('zero-change evidence promotes with token guard while unavailable evidence remains abortable', () => {
  const target = { instanceId: 902, instanceName: 'Remaining' };
  const stale = insertGate(availableEvidence(target));
  assertThrows(() => proceedRollout(stale.id, 'stale-token'), CanaryStaleTokenError);
  assertEquals(queuedCanaryJobs(), 0);

  const promoted = proceedRollout(stale.id, stale.token);
  assertEquals(promoted.status, 'rolling_out');
  assertEquals(queuedCanaryJobs(), 1);

  const abortable = insertGate(unavailableEvidence(target));
  const aborted = abortRollout(abortable.id, abortable.token);
  assertEquals(aborted.status, 'aborted');
  assertEquals(aborted.remainingPreview.availability, 'unavailable');
  assertEquals(queuedCanaryJobs(), 1, 'abort must not enqueue another rollout');
});

migratedTest('startRollout fails fast when the atomic canary outcome guard is lost', async () => {
  const restores: Restore[] = [];
  const canaryId = seedInstance('radarr');
  seedInstance('radarr');
  pinDefaultCanary(canaryId);
  const histId = seedHistoryRow(canaryId, 'success');
  installGetByIdProbe(restores);
  stubClassificationSearch(restores, [makeSummary({ id: histId, arrInstanceId: canaryId, status: 'success' })]);
  const originalRecord = canaryRolloutQueries.recordCanaryOutcome;
  canaryRolloutQueries.recordCanaryOutcome = () => false;
  restores.push(() => {
    canaryRolloutQueries.recordCanaryOutcome = originalRecord;
  });

  try {
    await assertRejects(() => startRollout({ arrType: 'radarr' }), CanaryStateError);
  } finally {
    undo(restores);
  }
});
