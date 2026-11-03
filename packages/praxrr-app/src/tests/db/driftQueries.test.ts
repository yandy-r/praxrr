import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { migration as addDriftRemediationMigration } from '$db/migrations/20261103_add_drift_remediation.ts';
import { migrationRunner, runMigrations } from '$db/migrations.ts';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { driftStatusQueries, type UpsertDriftStatusInput } from '$db/queries/driftStatus.ts';
import { driftRemediationPolicyQueries } from '$db/queries/driftRemediationPolicy.ts';
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
    driftDetectedAt: null,
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
  assertEquals(detail.counts, { drifted: 1, missing: 1, unmanaged: 0, prune: 0 });
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

// ---------------------------------------------------------------------------
// 20261103_add_drift_remediation (migration + suppression/remediation queries)
// ---------------------------------------------------------------------------

interface ColumnInfo {
  name: string;
  dflt_value: string | null;
}

function columnNames(table: string): string[] {
  return db.query<ColumnInfo>(`PRAGMA table_info(${table})`).map((column) => column.name);
}

const DRIFT_REMEDIATION_STATUS_COLUMNS = [
  'drift_detected_at',
  'acknowledged_signature',
  'acknowledged_at',
  'acknowledged_entity_keys',
  'snoozed_until',
  'last_remediation_trigger',
  'last_remediation_status',
  'last_remediation_signature',
  'last_remediation_at',
  'last_remediation_sync_history_id',
  'last_auto_attempt_signature',
];
const DRIFT_REMEDIATION_HISTORY_COLUMNS = ['drift_signature', 'drift_detected_at', 'remediation_trigger'];

migratedTest('migration 20261103: up adds columns with NULL/[] defaults and the policy table', async () => {
  assert(migrationRunner.isApplied(20261103));
  const statusColumns = columnNames('drift_instance_status');
  for (const column of DRIFT_REMEDIATION_STATUS_COLUMNS) {
    assert(statusColumns.includes(column), `drift_instance_status.${column} must exist`);
  }
  const historyColumns = columnNames('sync_history');
  for (const column of DRIFT_REMEDIATION_HISTORY_COLUMNS) {
    assert(historyColumns.includes(column), `sync_history.${column} must exist`);
  }
  assertEquals(columnNames('drift_remediation_policy'), [
    'arr_instance_id',
    'arr_type',
    'mode',
    'allowed_sections',
    'created_at',
    'updated_at',
  ]);
  const index = db.queryFirst<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sync_history_drift'"
  );
  assertExists(index);

  // A pre-existing-shaped row (written without any remediation column) reads as no ack,
  // no snooze, no remediation.
  const instanceId = seedInstance();
  await driftStatusQueries.upsert(makeUpsertInput(instanceId));
  const detail = driftStatusQueries.getById(instanceId);
  assertExists(detail);
  assertEquals(detail.driftDetectedAt, null);
  assertEquals(detail.acknowledgedSignature, null);
  assertEquals(detail.acknowledgedAt, null);
  assertEquals(detail.acknowledgedEntities, []);
  assertEquals(detail.snoozedUntil, null);
  assertEquals(detail.lastRemediation, { trigger: null, status: null, signature: null, at: null, syncHistoryId: null });
  assertEquals(detail.lastAutoAttemptSignature, null);
  const raw = db.queryFirst<{ acknowledged_entity_keys: string }>(
    'SELECT acknowledged_entity_keys FROM drift_instance_status WHERE arr_instance_id = ?',
    instanceId
  );
  assertEquals(raw?.acknowledged_entity_keys, '[]');

  // Absent policy row synthesizes `off`.
  assertEquals(driftRemediationPolicyQueries.get(instanceId, 'radarr'), {
    instanceId,
    arrType: 'radarr',
    mode: 'off',
    allowedSections: [],
    updatedAt: null,
  });
});

migratedTest('migration 20261103: down reverts every column, the table and the index', async () => {
  await migrationRunner.down([addDriftRemediationMigration], 20261102);
  assertEquals(migrationRunner.isApplied(20261103), false);
  const statusColumns = columnNames('drift_instance_status');
  for (const column of DRIFT_REMEDIATION_STATUS_COLUMNS) {
    assert(!statusColumns.includes(column), `drift_instance_status.${column} must be dropped`);
  }
  const historyColumns = columnNames('sync_history');
  for (const column of DRIFT_REMEDIATION_HISTORY_COLUMNS) {
    assert(!historyColumns.includes(column), `sync_history.${column} must be dropped`);
  }
  assertEquals(columnNames('drift_remediation_policy'), []);
  const index = db.queryFirst<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sync_history_drift'"
  );
  assertEquals(index, undefined);

  // Re-applying up after down succeeds (round-trip).
  await runMigrations();
  assert(migrationRunner.isApplied(20261103));
  assert(columnNames('drift_instance_status').includes('acknowledged_entity_keys'));
});

migratedTest('driftStatus.upsert persists driftDetectedAt and never touches suppression/remediation', async () => {
  const instanceId = seedInstance();
  await driftStatusQueries.upsert(
    makeUpsertInput(instanceId, { driftSignature: 'sig-a', driftDetectedAt: '2026-11-01T00:00:00.000Z' })
  );
  assert(
    driftStatusQueries.setSuppression(instanceId, 'sig-a', {
      acknowledgedSignature: 'sig-a',
      acknowledgedEntities: [{ key: 'k1', fingerprint: 'f1' }],
      snoozedUntil: '2026-11-10T00:00:00.000Z',
      acknowledgedAt: '2026-11-02T00:00:00.000Z',
    })
  );
  assert(
    driftStatusQueries.recordRemediation(instanceId, {
      trigger: 'reconcile',
      status: 'success',
      signature: 'sig-a',
      at: '2026-11-02T01:00:00.000Z',
      syncHistoryId: null,
    })
  );
  assert(driftStatusQueries.markAutoAttempt(instanceId, 'sig-a'));

  await driftStatusQueries.upsert(
    makeUpsertInput(instanceId, { driftSignature: 'sig-a', driftDetectedAt: '2026-11-01T00:00:00.000Z' })
  );

  const detail = driftStatusQueries.getById(instanceId);
  assertExists(detail);
  assertEquals(detail.driftDetectedAt, '2026-11-01T00:00:00.000Z');
  assertEquals(detail.acknowledgedSignature, 'sig-a');
  assertEquals(detail.acknowledgedEntities, [{ key: 'k1', fingerprint: 'f1' }]);
  assertEquals(detail.snoozedUntil, '2026-11-10T00:00:00.000Z');
  assertEquals(detail.acknowledgedAt, '2026-11-02T00:00:00.000Z');
  assertEquals(detail.lastRemediation.trigger, 'reconcile');
  assertEquals(detail.lastRemediation.status, 'success');
  assertEquals(detail.lastAutoAttemptSignature, 'sig-a');
});

migratedTest('driftStatus.setSuppression value guard returns false when the signature changed', async () => {
  const instanceId = seedInstance();
  await driftStatusQueries.upsert(makeUpsertInput(instanceId, { driftSignature: 'sig-b' }));

  const input = {
    acknowledgedSignature: 'sig-a',
    acknowledgedEntities: [],
    snoozedUntil: null,
    acknowledgedAt: '2026-11-02T00:00:00.000Z',
  };
  // Caller reviewed sig-a, but the stored signature is now sig-b → 409.
  assertEquals(driftStatusQueries.setSuppression(instanceId, 'sig-a', input), false);
  assertEquals(driftStatusQueries.getById(instanceId)?.acknowledgedSignature, null);
  // A null expectation never matches a non-null signature.
  assertEquals(driftStatusQueries.setSuppression(instanceId, null, input), false);
  // Unknown instance.
  assertEquals(driftStatusQueries.setSuppression(999_999, 'sig-b', input), false);

  assertEquals(
    driftStatusQueries.setSuppression(instanceId, 'sig-b', { ...input, acknowledgedSignature: 'sig-b' }),
    true
  );
  assertEquals(driftStatusQueries.getById(instanceId)?.acknowledgedSignature, 'sig-b');

  // `IS` semantics: a null expectation matches a null stored signature.
  await driftStatusQueries.upsert(makeUpsertInput(instanceId, { status: 'in-sync', driftSignature: null }));
  assertEquals(
    driftStatusQueries.setSuppression(instanceId, null, {
      acknowledgedSignature: null,
      acknowledgedEntities: [],
      snoozedUntil: '2026-11-10T00:00:00.000Z',
      acknowledgedAt: null,
    }),
    true
  );
  assertEquals(driftStatusQueries.getById(instanceId)?.snoozedUntil, '2026-11-10T00:00:00.000Z');
});

migratedTest(
  'driftStatus.clearStaleAcknowledgements clears a stale ack and prunes gone or changed entity acks',
  async () => {
    const instanceId = seedInstance();
    await driftStatusQueries.upsert(makeUpsertInput(instanceId, { driftSignature: 'sig-a' }));
    driftStatusQueries.setSuppression(instanceId, 'sig-a', {
      acknowledgedSignature: 'content-a',
      acknowledgedEntities: [
        { key: 'keep', fingerprint: 'f-keep' },
        { key: 'gone', fingerprint: 'f-gone' },
        { key: 'edited', fingerprint: 'f-old' },
      ],
      snoozedUntil: '2026-11-10T00:00:00.000Z',
      acknowledgedAt: '2026-11-02T00:00:00.000Z',
    });

    // Same content, every ack still matching → no-op.
    driftStatusQueries.clearStaleAcknowledgements(instanceId, 'content-a', [
      { key: 'keep', fingerprint: 'f-keep' },
      { key: 'gone', fingerprint: 'f-gone' },
      { key: 'edited', fingerprint: 'f-old' },
    ]);
    let detail = driftStatusQueries.getById(instanceId);
    assertEquals(detail?.acknowledgedSignature, 'content-a');
    assertEquals(detail?.acknowledgedEntities.length, 3);

    // Content changed → instance ack cleared; a gone key AND a same-key/changed-fingerprint ack are
    // pruned; snooze untouched.
    driftStatusQueries.clearStaleAcknowledgements(instanceId, 'content-b', [
      { key: 'keep', fingerprint: 'f-keep' },
      { key: 'edited', fingerprint: 'f-new' },
      { key: 'other', fingerprint: 'f-other' },
    ]);
    detail = driftStatusQueries.getById(instanceId);
    assertEquals(detail?.acknowledgedSignature, null);
    assertEquals(detail?.acknowledgedEntities, [{ key: 'keep', fingerprint: 'f-keep' }]);
    assertEquals(detail?.acknowledgedAt, '2026-11-02T00:00:00.000Z');
    assertEquals(detail?.snoozedUntil, '2026-11-10T00:00:00.000Z');

    // Nothing acked remains → acknowledged_at cleared too.
    driftStatusQueries.clearStaleAcknowledgements(instanceId, null, []);
    detail = driftStatusQueries.getById(instanceId);
    assertEquals(detail?.acknowledgedEntities, []);
    assertEquals(detail?.acknowledgedAt, null);
    assertEquals(detail?.snoozedUntil, '2026-11-10T00:00:00.000Z');
  }
);

migratedTest('driftStatus.recordRemediation stamps the outcome and the sync_history back-pointer', async () => {
  const instanceId = seedInstance();
  await driftStatusQueries.upsert(makeUpsertInput(instanceId, { driftSignature: 'sig-a' }));
  db.execute(
    `INSERT INTO sync_history (arr_instance_id, instance_name, arr_type, trigger, status, started_at)
		VALUES (?, 'Radarr Drift', 'radarr', 'manual', 'success', '2026-11-02T00:00:00.000Z')`,
    instanceId
  );
  const historyId = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;

  assert(
    driftStatusQueries.recordRemediation(instanceId, {
      trigger: 'auto',
      status: 'partial',
      signature: 'sig-a',
      at: '2026-11-02T00:00:01.000Z',
      syncHistoryId: historyId,
    })
  );
  assertEquals(driftStatusQueries.getById(instanceId)?.lastRemediation, {
    trigger: 'auto',
    status: 'partial',
    signature: 'sig-a',
    at: '2026-11-02T00:00:01.000Z',
    syncHistoryId: historyId,
  });

  // ON DELETE SET NULL: retention pruning the history row nulls the back-pointer.
  db.execute('DELETE FROM sync_history WHERE id = ?', historyId);
  assertEquals(driftStatusQueries.getById(instanceId)?.lastRemediation.syncHistoryId, null);

  assertEquals(
    driftStatusQueries.recordRemediation(999_999, {
      trigger: 'auto',
      status: 'failed',
      signature: null,
      at: '2026-11-02T00:00:01.000Z',
      syncHistoryId: null,
    }),
    false
  );
});

migratedTest('driftStatus.markAutoAttempt claims each signature exactly once', async () => {
  const instanceId = seedInstance();
  await driftStatusQueries.upsert(makeUpsertInput(instanceId, { driftSignature: 'sig-a' }));

  assertEquals(driftStatusQueries.markAutoAttempt(instanceId, 'sig-a'), true);
  assertEquals(driftStatusQueries.markAutoAttempt(instanceId, 'sig-a'), false);
  // Value guard: a signature that is not the stored drift signature is never claimed.
  assertEquals(driftStatusQueries.markAutoAttempt(instanceId, 'sig-b'), false);
  assertEquals(driftStatusQueries.getById(instanceId)?.lastAutoAttemptSignature, 'sig-a');
  // A new stored signature re-arms auto.
  await driftStatusQueries.upsert(makeUpsertInput(instanceId, { driftSignature: 'sig-b' }));
  assertEquals(driftStatusQueries.markAutoAttempt(instanceId, 'sig-b'), true);
  assertEquals(driftStatusQueries.getById(instanceId)?.lastAutoAttemptSignature, 'sig-b');
  assertEquals(driftStatusQueries.markAutoAttempt(999_999, 'sig-a'), false);

  // releaseAutoAttempt is value-guarded on the current claim.
  assertEquals(driftStatusQueries.releaseAutoAttempt(instanceId, 'sig-a'), false);
  assertEquals(driftStatusQueries.releaseAutoAttempt(instanceId, 'sig-b'), true);
  assertEquals(driftStatusQueries.getById(instanceId)?.lastAutoAttemptSignature, null);
});

migratedTest('driftStatus.recordRemediation never overwrites a newer outcome with an older signature', async () => {
  const instanceId = seedInstance();
  await driftStatusQueries.upsert(makeUpsertInput(instanceId, { driftSignature: 'sig-a' }));
  const rec = { trigger: 'auto' as const, at: '2026-11-02T00:00:00.000Z', syncHistoryId: null };

  // First record for any signature is allowed (nothing recorded yet).
  assert(driftStatusQueries.recordRemediation(instanceId, { ...rec, status: 'failed', signature: 'sig-old' }));
  // Current signature always records.
  assert(driftStatusQueries.recordRemediation(instanceId, { ...rec, status: 'success', signature: 'sig-a' }));
  // A late outcome for an older drift event is dropped.
  assertEquals(
    driftStatusQueries.recordRemediation(instanceId, { ...rec, status: 'failed', signature: 'sig-old' }),
    false
  );
  assertEquals(driftStatusQueries.getById(instanceId)?.lastRemediation.status, 'success');
  assertEquals(driftStatusQueries.getById(instanceId)?.lastRemediation.signature, 'sig-a');
});

migratedTest('driftRemediationPolicy: upsert/get round-trip, per arr_type', () => {
  const radarrId = seedInstance('Radarr Policy');
  const sonarrId = arrInstancesQueries.create({
    name: 'Sonarr Policy',
    type: 'sonarr',
    url: 'http://localhost:8989',
    apiKey: 'test-api-key',
  });

  const stored = driftRemediationPolicyQueries.upsert({
    instanceId: radarrId,
    arrType: 'radarr',
    mode: 'auto',
    allowedSections: ['qualityProfiles', 'mediaManagement'],
  });
  assertEquals(stored.mode, 'auto');
  assertEquals(stored.allowedSections, ['qualityProfiles', 'mediaManagement']);
  assert(stored.updatedAt !== null);
  assertEquals(driftRemediationPolicyQueries.get(radarrId, 'radarr'), stored);
  // A row stored for a different arr_type is never reused across Arr apps.
  assertEquals(driftRemediationPolicyQueries.get(radarrId, 'sonarr').mode, 'off');

  driftRemediationPolicyQueries.upsert({
    instanceId: sonarrId,
    arrType: 'sonarr',
    mode: 'notify',
    allowedSections: [],
  });
  assertEquals(driftRemediationPolicyQueries.get(sonarrId, 'sonarr').mode, 'notify');

  // Upsert replaces (no second row) and can turn auto off.
  driftRemediationPolicyQueries.upsert({ instanceId: radarrId, arrType: 'radarr', mode: 'off', allowedSections: [] });
  assertEquals(driftRemediationPolicyQueries.get(radarrId, 'radarr').mode, 'off');
  const count = db.queryFirst<{ count: number }>('SELECT COUNT(*) AS count FROM drift_remediation_policy');
  assertEquals(count?.count, 2);

  // Invalid mode is rejected by the CHECK constraint.
  let threw = false;
  try {
    db.execute(
      "INSERT INTO drift_remediation_policy (arr_instance_id, arr_type, mode) VALUES (?, 'radarr', 'always')",
      radarrId + sonarrId + 1000
    );
  } catch {
    threw = true;
  }
  assert(threw);
});
