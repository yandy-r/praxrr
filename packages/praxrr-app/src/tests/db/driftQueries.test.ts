import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { driftStatusQueries, type UpsertDriftStatusInput } from '$db/queries/driftStatus.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { DriftEntityChange } from '$sync/drift/types.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so migration 20260709 creates the drift tables
 * and seeds the settings singleton in its real context), invoke the test body,
 * then tear the connection down. Mirrors arrInstanceVersion.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/drift-queries-${crypto.randomUUID()}`;
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

/** Insert an arr_instances row so drift_instance_status has a valid FK target. */
function seedInstance(name = 'Radarr Drift'): number {
  return arrInstancesQueries.create({
    name,
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
}

function makeUpsertInput(instanceId: number, overrides: Partial<UpsertDriftStatusInput> = {}): UpsertDriftStatusInput {
  return {
    arrInstanceId: instanceId,
    arrType: 'radarr',
    status: 'drifted',
    reason: null,
    driftedCount: 1,
    missingCount: 1,
    unmanagedCount: 0,
    driftSignature: 'sig-abc',
    detectedVersion: '5.14.0.9383',
    changes: [],
    checkedAt: '2026-07-08T10:00:00.000Z',
    contentCheckedAt: '2026-07-08T10:00:00.000Z',
    durationMs: 123,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// drift_check_settings
// ---------------------------------------------------------------------------

migratedTest('driftSettings.get returns the migration-seeded singleton with schema defaults', () => {
  const settings = driftSettingsQueries.get();

  assertEquals(settings.id, 1);
  assertEquals(settings.enabled, 1);
  assertEquals(settings.interval_minutes, 360);
  assertEquals(settings.last_run_at, null);
  assertEquals(settings.error_count, 0);
  assertEquals(settings.backoff_until, null);
  assertEquals(settings.sweep_cursor, 0);
  assertEquals(settings.sweep_started_at, null);
  assertExists(settings.created_at);
  assertExists(settings.updated_at);
});

migratedTest('driftSettings.update persists enabled + intervalMinutes on the singleton', () => {
  assertEquals(driftSettingsQueries.update({ enabled: false, intervalMinutes: 60 }), true);

  const updated = driftSettingsQueries.get();
  assertEquals(updated.enabled, 0);
  assertEquals(updated.interval_minutes, 60);

  // A no-op update (no recognized fields) writes nothing and reports false.
  assertEquals(driftSettingsQueries.update({}), false);
  const unchanged = driftSettingsQueries.get();
  assertEquals(unchanged.enabled, 0);
  assertEquals(unchanged.interval_minutes, 60);
});

migratedTest('driftSettings.setSweepProgress persists the cursor + sweep start marker', () => {
  const startedAt = '2026-07-08T09:00:00.000Z';
  assertEquals(driftSettingsQueries.setSweepProgress(7, startedAt), true);

  const settings = driftSettingsQueries.get();
  assertEquals(settings.sweep_cursor, 7);
  assertEquals(settings.sweep_started_at, startedAt);
});

migratedTest('driftSettings.markRun advances last_run_at and clears backoff + sweep state', () => {
  // Arrange a dirty state: an outstanding failure/backoff plus an in-flight sweep.
  driftSettingsQueries.markFailure(4, '2026-07-08T11:00:00.000Z');
  driftSettingsQueries.setSweepProgress(9, '2026-07-08T09:30:00.000Z');

  const lastRunAt = '2026-07-08T12:00:00.000Z';
  assertEquals(driftSettingsQueries.markRun(lastRunAt), true);

  const settings = driftSettingsQueries.get();
  assertEquals(settings.last_run_at, lastRunAt);
  assertEquals(settings.error_count, 0);
  assertEquals(settings.backoff_until, null);
  assertEquals(settings.sweep_cursor, 0);
  assertEquals(settings.sweep_started_at, null);
});

migratedTest('driftSettings.markFailure records error_count + backoff and resets sweep progress', () => {
  // A sweep was mid-flight when the failure hit; markFailure must reset it.
  driftSettingsQueries.setSweepProgress(5, '2026-07-08T09:15:00.000Z');

  const backoffUntil = '2026-07-08T13:00:00.000Z';
  assertEquals(driftSettingsQueries.markFailure(3, backoffUntil), true);

  const settings = driftSettingsQueries.get();
  assertEquals(settings.error_count, 3);
  assertEquals(settings.backoff_until, backoffUntil);
  assertEquals(settings.sweep_cursor, 0);
  assertEquals(settings.sweep_started_at, null);
});

// ---------------------------------------------------------------------------
// drift_instance_status
// ---------------------------------------------------------------------------

migratedTest('driftStatus.upsert then getById round-trips the changes JSON blob and columns', async () => {
  const instanceId = seedInstance();

  const changes: DriftEntityChange[] = [
    {
      section: 'qualityProfiles',
      entityType: 'custom_format',
      name: 'HDR10',
      action: 'update',
      category: 'drift',
      remoteId: 42,
      fields: [{ field: 'score', type: 'changed', current: 100, desired: 250 }],
    },
    {
      section: 'qualityProfiles',
      entityType: 'quality_profile',
      name: 'HD-1080p',
      action: 'create',
      category: 'missing',
      remoteId: null,
      fields: [],
    },
  ];

  await driftStatusQueries.upsert(
    makeUpsertInput(instanceId, {
      status: 'drifted',
      reason: null,
      driftedCount: 1,
      missingCount: 1,
      unmanagedCount: 0,
      driftSignature: 'sig-round-trip',
      changes,
    })
  );

  const detail = driftStatusQueries.getById(instanceId);
  assertExists(detail);
  assertEquals(detail.arrInstanceId, instanceId);
  assertEquals(detail.arrType, 'radarr');
  assertEquals(detail.status, 'drifted');
  assertEquals(detail.reason, null);
  assertEquals(detail.counts, { drifted: 1, missing: 1, unmanaged: 0 });
  assertEquals(detail.driftSignature, 'sig-round-trip');
  assertEquals(detail.detectedVersion, '5.14.0.9383');
  assertEquals(detail.checkedAt, '2026-07-08T10:00:00.000Z');
  assertEquals(detail.contentCheckedAt, '2026-07-08T10:00:00.000Z');
  assertEquals(detail.durationMs, 123);
  // notified_signature is managed separately and untouched by upsert.
  assertEquals(detail.notifiedSignature, null);
  // The JSON blob decodes back to the exact structured changes we wrote.
  assertEquals(detail.changes, changes);
});

migratedTest('driftStatus.upsert replaces the single latest-state row (summary length stays 1)', async () => {
  const instanceId = seedInstance();

  await driftStatusQueries.upsert(
    makeUpsertInput(instanceId, {
      status: 'drifted',
      driftedCount: 2,
      driftSignature: 'sig-first',
      changes: [
        {
          section: 'qualityProfiles',
          entityType: 'custom_format',
          name: 'First',
          action: 'update',
          category: 'drift',
          remoteId: 1,
          fields: [],
        },
      ],
    })
  );

  assertEquals(driftStatusQueries.getAllForSummary().length, 1);

  // Second upsert for the same instance must UPDATE-on-conflict, not insert a row.
  await driftStatusQueries.upsert(
    makeUpsertInput(instanceId, {
      status: 'in-sync',
      driftedCount: 0,
      missingCount: 0,
      driftSignature: null,
      detectedVersion: '5.15.0.0000',
      changes: [],
      checkedAt: '2026-07-08T14:00:00.000Z',
    })
  );

  const summary = driftStatusQueries.getAllForSummary();
  assertEquals(summary.length, 1);

  const detail = driftStatusQueries.getById(instanceId);
  assertExists(detail);
  assertEquals(detail.status, 'in-sync');
  assertEquals(detail.counts.drifted, 0);
  assertEquals(detail.driftSignature, null);
  assertEquals(detail.detectedVersion, '5.15.0.0000');
  assertEquals(detail.checkedAt, '2026-07-08T14:00:00.000Z');
  assertEquals(detail.changes, []);
});

migratedTest('driftStatus.markNotified stamps notified_signature on the existing row', async () => {
  const instanceId = seedInstance();
  await driftStatusQueries.upsert(makeUpsertInput(instanceId, { driftSignature: 'sig-notify' }));

  // Baseline: upsert never sets notified_signature.
  assertEquals(driftStatusQueries.getById(instanceId)?.notifiedSignature, null);

  assertEquals(driftStatusQueries.markNotified(instanceId, 'sig-notify'), true);
  assertEquals(driftStatusQueries.getById(instanceId)?.notifiedSignature, 'sig-notify');

  // It can also be cleared back to null.
  assertEquals(driftStatusQueries.markNotified(instanceId, null), true);
  assertEquals(driftStatusQueries.getById(instanceId)?.notifiedSignature, null);
});

migratedTest('driftStatus.getById returns undefined for an instance with no drift row', () => {
  assert(driftStatusQueries.getById(999_999) === undefined);
  // And markNotified reports no rows affected when there is nothing to stamp.
  assertEquals(driftStatusQueries.markNotified(999_999, 'sig'), false);
});
