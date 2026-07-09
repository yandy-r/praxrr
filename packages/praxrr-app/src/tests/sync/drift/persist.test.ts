import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { driftStatusQueries, type DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';
import { checkAndPersistInstance, shouldNotify, type CheckAndPersistOutcome } from '$sync/drift/persist.ts';
import type { DriftCheckDeps } from '$sync/drift/check.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type { EntityChange, SyncPreviewSection } from '$sync/preview/types.ts';
import type { InstanceDriftResult } from '$sync/drift/types.ts';
import { resetPreviewCreateRateLimitForTests } from '$sync/preview/limits.ts';

/**
 * Integration coverage for the drift "persist + notify" shell (design §10) against a REAL
 * migrated SQLite app DB. Each case points the `db` singleton at a fresh scratch file, runs
 * the full migration chain (so `drift_instance_status` and the FK to `arr_instances` exist),
 * resets the shared preview rate-limit window, then runs the test body. The drift check's IO
 * boundary is fully stubbed via `DriftCheckDeps` so the assertions exercise persist.ts wiring
 * (outcome union, failed-check preservation, dedup notify, in-flight guard, never-throws) and
 * the real query layer — never the network.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/drift-persist-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);
      resetPreviewCreateRateLimitForTests();

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createInstance(name: string): ArrInstance {
  const id = arrInstancesQueries.create({
    name,
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
  const row = arrInstancesQueries.getById(id);
  assertExists(row);
  return row;
}

/**
 * Unwrap a successful outcome to its `InstanceDriftResult`, failing the test loudly on the
 * `in_flight`/`error` discriminants. `checkAndPersistInstance` now returns a discriminated
 * union, so every "success" call site narrows through here.
 */
function expectOk(outcome: CheckAndPersistOutcome): InstanceDriftResult {
  assertEquals(outcome.kind, 'ok');
  if (outcome.kind !== 'ok') {
    throw new Error(`expected an ok outcome, got kind=${outcome.kind}`);
  }
  return outcome.result;
}

const UPDATE_ENTITY: EntityChange = {
  entityType: 'qualityProfile',
  name: 'HD-1080p',
  action: 'update',
  remoteId: 7,
  fields: [{ field: 'cutoff', type: 'changed', current: 1, desired: 2 }],
};

const OTHER_UPDATE_ENTITY: EntityChange = {
  entityType: 'qualityProfile',
  name: 'UHD-2160p',
  action: 'update',
  remoteId: 9,
  fields: [{ field: 'cutoff', type: 'changed', current: 3, desired: 4 }],
};

const DELETE_ENTITY: EntityChange = {
  entityType: 'qualityProfile',
  name: 'Legacy-Profile',
  action: 'delete',
  remoteId: 3,
  fields: [],
};

/** A single successful `qualityProfiles` preview carrying the given entity changes. */
function previewWith(instance: ArrInstance, qualityProfiles: EntityChange[]): GeneratePreviewResult {
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: 0,
    sections: ['qualityProfiles'],
    sectionOutcomes: [{ section: 'qualityProfiles', error: null, skipped: false }],
    qualityProfiles: { section: 'qualityProfiles', customFormats: [], qualityProfiles },
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
    errors: [],
  };
}

/**
 * A two-section preview where `qualityProfiles` compared clean (no changes) while
 * `delayProfiles` errored. `aggregateDrift` reports `anySectionErrored`, so the whole check is
 * an incomplete diff: `checkInstanceDrift` surfaces `error`/`invalid_response` with a null
 * `contentCheckedAt`, and persist must NOT overwrite prior drift with this partial "clean" pass.
 */
function partialFailurePreview(instance: ArrInstance): GeneratePreviewResult {
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: 0,
    sections: ['qualityProfiles', 'delayProfiles'],
    sectionOutcomes: [
      { section: 'qualityProfiles', error: null, skipped: false },
      { section: 'delayProfiles', error: 'delay profile fetch failed', skipped: false },
    ],
    // qualityProfiles compared clean (present, no changes); delayProfiles errored (null payload).
    qualityProfiles: { section: 'qualityProfiles', customFormats: [], qualityProfiles: [] },
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
    errors: [],
  };
}

/**
 * Fully stubbed drift deps: reachable heartbeat, ready cache, one available section, an
 * always-allowed rate gate, and a fixed clock. Callers override `generatePreview`/`now`.
 */
function deps(overrides: Partial<DriftCheckDeps> = {}): Partial<DriftCheckDeps> {
  return {
    heartbeat: () => Promise.resolve({ ok: true, version: '5.0.0' }),
    isPcdCacheReady: () => true,
    resolveAvailableSections: () => new Set<SyncPreviewSection>(['qualityProfiles']),
    registerPreviewAttempt: () => true,
    now: () => Date.parse('2026-07-08T10:00:00.000Z'),
    budgetMs: 20_000,
    generatePreview: () => Promise.resolve(previewWith({ id: 0, name: '' } as ArrInstance, [])),
    ...overrides,
  };
}

function driftedDeps(instance: ArrInstance, entities: EntityChange[], nowIso: string): Partial<DriftCheckDeps> {
  return deps({
    now: () => Date.parse(nowIso),
    generatePreview: () => Promise.resolve(previewWith(instance, entities)),
  });
}

/**
 * Deps whose available set spans two sections but whose preview errors one of them while the
 * other compares clean — the PARTIAL section failure path.
 */
function partialFailureDeps(instance: ArrInstance, nowIso: string): Partial<DriftCheckDeps> {
  return deps({
    now: () => Date.parse(nowIso),
    resolveAvailableSections: () => new Set<SyncPreviewSection>(['qualityProfiles', 'delayProfiles']),
    generatePreview: () => Promise.resolve(partialFailurePreview(instance)),
  });
}

function driftRowCount(): number {
  return db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM drift_instance_status')?.n ?? 0;
}

/** Drain the fire-and-forget notify → markNotified microtask chain. */
function flush(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until the row's notified_signature settles to the expected value (or give up). */
async function awaitNotified(instanceId: number, expected: string | null, tries = 60): Promise<string | null> {
  for (let i = 0; i < tries; i += 1) {
    const sig = driftStatusQueries.getById(instanceId)?.notifiedSignature ?? null;
    if (sig === expected) {
      return sig;
    }
    await flush(5);
  }
  return driftStatusQueries.getById(instanceId)?.notifiedSignature ?? null;
}

// ---------------------------------------------------------------------------
// Pure predicate: shouldNotify (dedups PURELY on notified_signature)
// ---------------------------------------------------------------------------

function driftResult(overrides: Partial<InstanceDriftResult> = {}): InstanceDriftResult {
  return {
    instanceId: 1,
    instanceName: 'Radarr',
    arrType: 'radarr',
    status: 'drifted',
    reason: null,
    detectedVersion: '5.0.0',
    counts: { drifted: 1, missing: 0, unmanaged: 0 },
    changes: [],
    driftSignature: 'sig-a',
    checkedAt: '2026-07-08T10:00:00.000Z',
    contentCheckedAt: '2026-07-08T10:00:00.000Z',
    durationMs: 5,
    ...overrides,
  };
}

function priorDetail(overrides: Partial<DriftInstanceStatusDetail> = {}): DriftInstanceStatusDetail {
  return {
    arrInstanceId: 1,
    arrType: 'radarr',
    status: 'drifted',
    reason: null,
    counts: { drifted: 1, missing: 0, unmanaged: 0 },
    driftSignature: 'sig-a',
    notifiedSignature: 'sig-a',
    detectedVersion: '5.0.0',
    changes: [],
    checkedAt: '2026-07-08T10:00:00.000Z',
    contentCheckedAt: '2026-07-08T10:00:00.000Z',
    durationMs: 5,
    createdAt: '2026-07-08T10:00:00.000Z',
    updatedAt: '2026-07-08T10:00:00.000Z',
    ...overrides,
  };
}

Deno.test('shouldNotify fires on newly detected drift (no prior notified signature)', () => {
  // No prior row at all → fire.
  assert(shouldNotify(undefined, driftResult({ driftSignature: 'sig-a' })));
  // Prior row exists but nothing was ever notified (null signature) → fire.
  assert(shouldNotify(priorDetail({ notifiedSignature: null }), driftResult({ driftSignature: 'sig-a' })));
});

Deno.test('shouldNotify does NOT re-fire when the notified signature already matches', () => {
  const prior = priorDetail({ status: 'drifted', notifiedSignature: 'sig-a' });
  assertEquals(shouldNotify(prior, driftResult({ driftSignature: 'sig-a' })), false);
});

Deno.test('shouldNotify re-fires when the alerting drift set changes', () => {
  const prior = priorDetail({ status: 'drifted', notifiedSignature: 'sig-a' });
  assert(shouldNotify(prior, driftResult({ driftSignature: 'sig-b' })));
});

Deno.test('shouldNotify dedups purely on notified signature, ignoring prior status', () => {
  // drifted → transient error → drifted with the SAME signature: the prior row now reads
  // status=error, but its notified_signature is still sig-a, so the returning identical drift
  // must NOT re-fire. Dedup keys on notified_signature ONLY, never on prior.status.
  const priorError = priorDetail({ status: 'error', reason: 'invalid_response', notifiedSignature: 'sig-a' });
  assertEquals(shouldNotify(priorError, driftResult({ driftSignature: 'sig-a' })), false);
  // A DIFFERENT signature returning after that same error DOES fire.
  assert(shouldNotify(priorError, driftResult({ driftSignature: 'sig-c' })));
});

Deno.test('shouldNotify never fires on a non-drifted status', () => {
  // Unmanaged-only resolves to in-sync with a null signature: non-alerting.
  assertEquals(
    shouldNotify(
      priorDetail(),
      driftResult({ status: 'in-sync', driftSignature: null, counts: { drifted: 0, missing: 0, unmanaged: 2 } })
    ),
    false
  );
  // Recovery drifted → in-sync must never notify.
  assertEquals(
    shouldNotify(priorDetail({ status: 'drifted' }), driftResult({ status: 'in-sync', driftSignature: null })),
    false
  );
  // Reachability/error statuses never notify, even with no prior row.
  assertEquals(shouldNotify(undefined, driftResult({ status: 'unreachable', reason: 'timeout' })), false);
  assertEquals(
    shouldNotify(
      priorDetail({ notifiedSignature: null }),
      driftResult({ status: 'error', reason: 'invalid_response', driftSignature: null })
    ),
    false
  );
});

// ---------------------------------------------------------------------------
// Integration: persist + notify shell (real DB)
// ---------------------------------------------------------------------------

migratedTest('a successful drift check upserts exactly one row with the fresh diff', async () => {
  const instance = createInstance('Radarr Upsert');

  const result = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z'))
  );

  assertEquals(result.status, 'drifted');
  assertEquals(driftRowCount(), 1);

  const row = driftStatusQueries.getById(instance.id);
  assertExists(row);
  assertEquals(row.status, 'drifted');
  assertEquals(row.counts.drifted, 1);
  assertEquals(row.counts.missing, 0);
  assertEquals(row.counts.unmanaged, 0);
  assertEquals(row.changes.length, 1);
  assertEquals(row.changes[0].name, 'HD-1080p');
  assertEquals(row.driftSignature, result.driftSignature);
  assertEquals(row.contentCheckedAt, '2026-07-08T10:00:00.000Z');
});

migratedTest('a second check REPLACES the row — count stays 1, no growth', async () => {
  const instance = createInstance('Radarr Replace');

  expectOk(await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z')));
  assertEquals(driftRowCount(), 1);

  // Second, different diff for the same instance.
  const second = expectOk(
    await checkAndPersistInstance(
      instance,
      driftedDeps(instance, [UPDATE_ENTITY, OTHER_UPDATE_ENTITY], '2026-07-08T11:00:00.000Z')
    )
  );
  assertEquals(second.counts.drifted, 2);

  assertEquals(driftRowCount(), 1);
  const row = driftStatusQueries.getById(instance.id);
  assertExists(row);
  assertEquals(row.counts.drifted, 2);
  assertEquals(row.checkedAt, '2026-07-08T11:00:00.000Z');
});

migratedTest('a failed check preserves prior changes and content_checked_at', async () => {
  const instance = createInstance('Radarr Failed');

  // Establish a last-known-good drifted state.
  expectOk(await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z')));
  const before = driftStatusQueries.getById(instance.id);
  assertExists(before);
  assertEquals(before.status, 'drifted');

  // Now the instance goes unreachable (heartbeat fails, no status → timeout). This is a normal
  // (non-throwing) degraded result, so it is still an `ok` outcome carrying the failed status.
  const failed = expectOk(
    await checkAndPersistInstance(
      instance,
      deps({ now: () => Date.parse('2026-07-08T12:00:00.000Z'), heartbeat: () => Promise.resolve({ ok: false }) })
    )
  );
  assertEquals(failed.status, 'unreachable');
  assertEquals(failed.contentCheckedAt, null);

  const after = driftStatusQueries.getById(instance.id);
  assertExists(after);
  // Status/reason reflect the failed check...
  assertEquals(after.status, 'unreachable');
  assertEquals(after.reason, 'timeout');
  assertEquals(after.checkedAt, '2026-07-08T12:00:00.000Z');
  // ...but the last-known content is preserved, never blanked.
  assertEquals(after.counts.drifted, 1);
  assertEquals(after.changes.length, 1);
  assertEquals(after.changes[0].name, 'HD-1080p');
  assertEquals(after.contentCheckedAt, '2026-07-08T10:00:00.000Z');
  assertEquals(after.driftSignature, before.driftSignature);
  // Still one row.
  assertEquals(driftRowCount(), 1);
});

migratedTest('a PARTIAL section failure preserves prior drift and does not blank it to in-sync', async () => {
  const instance = createInstance('Radarr Partial');

  // Establish a last-known-good drifted state on the qualityProfiles section.
  expectOk(await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z')));
  const before = driftStatusQueries.getById(instance.id);
  assertExists(before);
  assertEquals(before.status, 'drifted');
  assertEquals(before.counts.drifted, 1);
  assertExists(before.driftSignature);

  // Next check: two available sections, one errors (delayProfiles) while the other compares
  // clean (qualityProfiles, now with no changes). Because at least one available section
  // errored, the check is an INCOMPLETE diff — it must surface error/invalid_response with a
  // null content stamp, NOT a false in-sync that erases the drift in the failed section.
  const partial = expectOk(
    await checkAndPersistInstance(instance, partialFailureDeps(instance, '2026-07-08T12:00:00.000Z'))
  );
  assertEquals(partial.status, 'error');
  assertEquals(partial.reason, 'invalid_response');
  assertEquals(partial.contentCheckedAt, null);
  assertEquals(partial.counts.drifted, 0);
  assertEquals(partial.driftSignature, null);

  const after = driftStatusQueries.getById(instance.id);
  assertExists(after);
  // The failed status/reason and advancing checkedAt are recorded...
  assertEquals(after.status, 'error');
  assertEquals(after.reason, 'invalid_response');
  assertEquals(after.checkedAt, '2026-07-08T12:00:00.000Z');
  // ...but the prior content (drift in the section that could NOT be re-verified) is preserved
  // verbatim rather than overwritten with the clean partial snapshot.
  assertEquals(after.counts.drifted, before.counts.drifted);
  assertEquals(after.changes.length, 1);
  assertEquals(after.changes[0].name, 'HD-1080p');
  assertEquals(after.driftSignature, before.driftSignature);
  assertEquals(after.contentCheckedAt, before.contentCheckedAt);
  assertEquals(driftRowCount(), 1);
});

migratedTest('drift emit advances notified_signature; unmanaged-only never notifies', async () => {
  const drifted = createInstance('Radarr Notify');
  const unmanaged = createInstance('Radarr Unmanaged');

  // Drifted (alerting) instance: notify fires, notified_signature advances after emit.
  const result = expectOk(
    await checkAndPersistInstance(drifted, driftedDeps(drifted, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z'))
  );
  assertExists(result.driftSignature);

  // Immediately after the call returns, the upsert has NOT touched notified_signature —
  // it only advances via the fire-and-forget emit callback.
  const immediate = driftStatusQueries.getById(drifted.id);
  assertExists(immediate);
  assertEquals(immediate.notifiedSignature, null);

  const notified = await awaitNotified(drifted.id, result.driftSignature);
  assertEquals(notified, result.driftSignature);

  // Unmanaged-only resolves to in-sync: no emit, notified_signature stays null.
  const unmanagedResult = expectOk(
    await checkAndPersistInstance(unmanaged, driftedDeps(unmanaged, [DELETE_ENTITY], '2026-07-08T10:00:00.000Z'))
  );
  assertEquals(unmanagedResult.status, 'in-sync');
  assertEquals(unmanagedResult.counts.unmanaged, 1);

  await flush();
  const unmanagedRow = driftStatusQueries.getById(unmanaged.id);
  assertExists(unmanagedRow);
  assertEquals(unmanagedRow.counts.unmanaged, 1);
  assertEquals(unmanagedRow.notifiedSignature, null);
});

migratedTest('a changed drift set re-advances notified_signature after a new emit', async () => {
  const instance = createInstance('Radarr Resignature');

  const first = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z'))
  );
  const sigA = await awaitNotified(instance.id, first.driftSignature);
  assertEquals(sigA, first.driftSignature);

  // Identical repeat: prior.notifiedSignature === next.driftSignature, so shouldNotify is
  // false and the signature must not move.
  const repeat = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:30:00.000Z'))
  );
  assertEquals(repeat.driftSignature, first.driftSignature);
  await flush();
  assertEquals(driftStatusQueries.getById(instance.id)?.notifiedSignature, sigA);

  // Changed alerting set → new signature → re-emit advances notified_signature.
  const changed = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [OTHER_UPDATE_ENTITY], '2026-07-08T11:00:00.000Z'))
  );
  assert(changed.driftSignature !== first.driftSignature);
  const sigB = await awaitNotified(instance.id, changed.driftSignature);
  assertEquals(sigB, changed.driftSignature);
});

migratedTest('a genuine recovery clears notified_signature so an identical drift re-fires', async () => {
  const instance = createInstance('Radarr Recovery');

  // Notified drift establishes notified_signature = sigA.
  const first = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z'))
  );
  const sigA = await awaitNotified(instance.id, first.driftSignature);
  assertEquals(sigA, first.driftSignature);

  // A fully-clean CONTENT refresh (real successful diff, no alerting drift) is a genuine
  // recovery: persist clears notified_signature back to null even though nothing re-notified.
  const recovered = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [], '2026-07-08T11:00:00.000Z'))
  );
  assertEquals(recovered.status, 'in-sync');
  assertEquals(recovered.driftSignature, null);
  assertExists(recovered.contentCheckedAt);
  // markNotified(null) runs synchronously inside the recovery branch, before the call resolves.
  assertEquals(driftStatusQueries.getById(instance.id)?.notifiedSignature, null);

  // The SAME drift set returns after the genuine recovery → it MUST re-fire, advancing
  // notified_signature back to the (identical) signature.
  const again = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T12:00:00.000Z'))
  );
  assertEquals(again.driftSignature, first.driftSignature);
  const reNotified = await awaitNotified(instance.id, again.driftSignature);
  assertEquals(reNotified, again.driftSignature);
});

migratedTest('drifted → transient error → drifted with the SAME set does NOT re-fire', async () => {
  const instance = createInstance('Radarr Transient');

  // 1. Notified drift → notified_signature = sigA.
  const first = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z'))
  );
  const sigA = await awaitNotified(instance.id, first.driftSignature);
  assertEquals(sigA, first.driftSignature);

  // 2. Transient partial-section error. This is NOT a content refresh (contentCheckedAt=null),
  // so the recovery-clear branch is skipped: notified_signature must stay sigA and the prior
  // drift signature must be preserved (so the returning drift keeps the SAME signature).
  const errored = expectOk(
    await checkAndPersistInstance(instance, partialFailureDeps(instance, '2026-07-08T11:00:00.000Z'))
  );
  assertEquals(errored.status, 'error');
  const errorRow = driftStatusQueries.getById(instance.id);
  assertExists(errorRow);
  assertEquals(errorRow.status, 'error');
  assertEquals(errorRow.notifiedSignature, sigA); // NOT cleared by the error step.
  assertEquals(errorRow.driftSignature, first.driftSignature); // Prior drift signature preserved.

  // The persist path's decision on the error row is definitively non-firing: the returning
  // identical drift's signature already equals the row's notified_signature.
  assertEquals(
    shouldNotify(errorRow, driftResult({ instanceId: instance.id, driftSignature: errorRow.driftSignature })),
    false
  );

  // 3. The SAME drift set returns. Because notified_signature already matches its signature,
  // drift.detected must NOT re-fire and notified_signature must remain sigA (unchanged).
  const returned = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T12:00:00.000Z'))
  );
  assertEquals(returned.status, 'drifted');
  assertEquals(returned.driftSignature, first.driftSignature);

  await flush();
  const finalRow = driftStatusQueries.getById(instance.id);
  assertExists(finalRow);
  assertEquals(finalRow.status, 'drifted');
  assertEquals(finalRow.notifiedSignature, sigA); // Unchanged — no re-fire across the transient error.
  assertEquals(driftRowCount(), 1);
});

migratedTest('checkAndPersistInstance returns { kind: error } (never throws) on an unexpected dep error', async () => {
  const instance = createInstance('Radarr Throws');

  // A throwing clock escapes checkInstanceDrift's inner guards and must be caught by the
  // persist shell, which logs and returns { kind: 'error' } rather than propagating.
  const outcome = await checkAndPersistInstance(
    instance,
    deps({
      now: () => {
        throw new Error('clock exploded');
      },
    })
  );

  assertEquals(outcome.kind, 'error');
  // The failure happened before any upsert — no partial row was written.
  assertEquals(driftRowCount(), 0);

  // The in-flight guard was released in `finally`, so a subsequent healthy check still runs.
  const recovered = expectOk(
    await checkAndPersistInstance(instance, driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z'))
  );
  assertEquals(recovered.status, 'drifted');
  assertEquals(driftRowCount(), 1);
});

migratedTest('an already-in-flight instance returns { kind: in_flight } without a second write', async () => {
  const instance = createInstance('Radarr InFlight');

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  // First call blocks inside the heartbeat, holding the in-flight slot for `instance.id`.
  const blocked = checkAndPersistInstance(
    instance,
    deps({
      heartbeat: async () => {
        await gate;
        return { ok: true, version: '5.0.0' };
      },
      generatePreview: () => Promise.resolve(previewWith(instance, [UPDATE_ENTITY])),
    })
  );

  // Concurrent call for the SAME instance is rejected as in-flight.
  const concurrent = await checkAndPersistInstance(
    instance,
    driftedDeps(instance, [UPDATE_ENTITY], '2026-07-08T10:00:00.000Z')
  );
  assertEquals(concurrent.kind, 'in_flight');

  // Unblock and let the first call finish.
  release();
  const first = expectOk(await blocked);
  assertEquals(first.status, 'drifted');
  assertEquals(driftRowCount(), 1);
});
