import { assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import { driftRemediationPolicyQueries } from '$db/queries/driftRemediationPolicy.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import type { CanaryArrType } from '$sync/canary/types.ts';
import { driftSignature } from '$sync/drift/check.ts';
import {
  type AutoRemediationCanaryContext,
  decideAutoRemediation,
  queueAutoRemediationIfEligible,
} from '$sync/drift/remediation.ts';
import { checkAndPersistInstance } from '$sync/drift/persist.ts';
import type { DriftEntityChange } from '$sync/drift/types.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type { EntityChange, SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';

/**
 * Auto-remediation decision + enqueue shell (plan §8 "Auto off by default", "Canary path")
 * against a real migrated app DB. The dispatcher wake is stubbed so an enqueued job never runs.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/drift-remediation-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });
      const originalNotify = jobDispatcher.notifyJobEnqueued;
      jobDispatcher.notifyJobEnqueued = () => {};

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.notifyJobEnqueued = originalNotify;
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

const QP_DRIFT: DriftEntityChange = {
  section: 'qualityProfiles',
  entityType: 'qualityProfile',
  name: 'HD-1080p',
  action: 'update',
  category: 'drift',
  remoteId: 7,
  fields: [{ field: 'cutoff', type: 'changed', current: 1, desired: 2 }],
};

function createInstance(name: string, type: SyncPreviewArrType = 'radarr'): ArrInstance {
  const id = arrInstancesQueries.create({ name, type, url: 'http://localhost:7878', apiKey: 'test-api-key' });
  const row = arrInstancesQueries.getById(id);
  assertExists(row);
  return row;
}

function seedDrifted(instance: ArrInstance, changes: DriftEntityChange[] = [QP_DRIFT]): string {
  const signature = driftSignature(changes);
  assertExists(signature);
  const now = new Date().toISOString();
  driftStatusQueries.upsert({
    arrInstanceId: instance.id,
    arrType: instance.type,
    status: 'drifted',
    reason: null,
    driftedCount: changes.length,
    missingCount: 0,
    unmanagedCount: 0,
    driftSignature: signature,
    detectedVersion: null,
    changes,
    checkedAt: now,
    contentCheckedAt: now,
    durationMs: 1,
    driftDetectedAt: now,
  });
  return signature;
}

function enableAuto(instance: ArrInstance): void {
  driftRemediationPolicyQueries.upsert({
    instanceId: instance.id,
    arrType: instance.type as SyncPreviewArrType,
    mode: 'auto',
    allowedSections: ['qualityProfiles'],
  });
}

function jobCount(): number {
  return db.queryFirst<{ count: number }>('SELECT COUNT(*) AS count FROM job_queue')?.count ?? 0;
}

function remediateJobCount(): number {
  return (
    db.queryFirst<{ count: number }>("SELECT COUNT(*) AS count FROM job_queue WHERE job_type = 'drift.remediate'")
      ?.count ?? 0
  );
}

function openRollout(arrType: CanaryArrType, canary: ArrInstance): void {
  canaryRolloutQueries.insert({
    arrType,
    canaryInstanceId: canary.id,
    canaryInstanceName: canary.name,
    sections: null,
    maxBatchSize: 1,
    partialPolicy: 'gate',
    remainingTargets: [],
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    stateToken: crypto.randomUUID(),
  });
}

const NO_CANARY: AutoRemediationCanaryContext = {
  enabled: false,
  cohortSize: 1,
  isDefaultCanary: false,
  activeRolloutForType: false,
};

// ---------------------------------------------------------------------------
// Auto off by default
// ---------------------------------------------------------------------------

migratedTest('auto off by default: no policy row → skip mode_off and nothing enqueued', () => {
  const instance = createInstance('Radarr A');
  seedDrifted(instance);

  const policy = driftRemediationPolicyQueries.get(instance.id, 'radarr');
  assertEquals(policy.mode, 'off');
  assertEquals(policy.updatedAt, null);
  const decision = decideAutoRemediation({
    policy,
    row: driftStatusQueries.getById(instance.id),
    nowMs: Date.now(),
    canary: NO_CANARY,
    sectionsInProgress: [],
    versionAvailable: new Set(['qualityProfiles']),
  });
  assertEquals(decision, { kind: 'skip', reason: 'mode_off' });

  queueAutoRemediationIfEligible(instance);
  assertEquals(jobCount(), 0);
  assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, null);
});

migratedTest('auto off by default: notify mode → skip mode_notify and nothing enqueued', () => {
  const instance = createInstance('Radarr A');
  seedDrifted(instance);
  const policy = driftRemediationPolicyQueries.upsert({
    instanceId: instance.id,
    arrType: 'radarr',
    mode: 'notify',
    allowedSections: ['qualityProfiles'],
  });

  const decision = decideAutoRemediation({
    policy,
    row: driftStatusQueries.getById(instance.id),
    nowMs: Date.now(),
    canary: NO_CANARY,
    sectionsInProgress: [],
    versionAvailable: new Set(['qualityProfiles']),
  });
  assertEquals(decision, { kind: 'skip', reason: 'mode_notify' });

  queueAutoRemediationIfEligible(instance);
  assertEquals(jobCount(), 0);
});

migratedTest('auto mode on an in-sync row → skip not_drifted, nothing enqueued', () => {
  const instance = createInstance('Radarr A');
  enableAuto(instance);
  const now = new Date().toISOString();
  driftStatusQueries.upsert({
    arrInstanceId: instance.id,
    arrType: 'radarr',
    status: 'in-sync',
    reason: null,
    driftedCount: 0,
    missingCount: 0,
    unmanagedCount: 0,
    driftSignature: null,
    detectedVersion: null,
    changes: [],
    checkedAt: now,
    contentCheckedAt: now,
    durationMs: 1,
    driftDetectedAt: null,
  });

  queueAutoRemediationIfEligible(instance);
  assertEquals(jobCount(), 0);
});

migratedTest('auto mode, drifted, no canary → enqueues exactly one deduped drift.remediate job', () => {
  const instance = createInstance('Radarr A');
  const signature = seedDrifted(instance);
  enableAuto(instance);

  queueAutoRemediationIfEligible(instance);
  queueAutoRemediationIfEligible(instance);

  assertEquals(remediateJobCount(), 1);
  const row = db.queryFirst<{ payload: string; source: string; dedupe_key: string }>(
    "SELECT payload, source, dedupe_key FROM job_queue WHERE job_type = 'drift.remediate'"
  );
  assertExists(row);
  assertEquals(JSON.parse(row.payload), { instanceId: instance.id, driftSignature: signature });
  assertEquals(row.source, 'system');
  assertEquals(row.dedupe_key, `drift.remediate:${instance.id}`);
});

// ---------------------------------------------------------------------------
// Canary path
// ---------------------------------------------------------------------------

migratedTest('canary: enabled + cohort > 1 + not default canary → held_canary, no job', () => {
  const canary = createInstance('Radarr Canary');
  const instance = createInstance('Radarr B');
  const signature = seedDrifted(instance);
  enableAuto(instance);
  canarySettingsQueries.update({ enabled: true, defaultCanaryInstanceId: canary.id });

  queueAutoRemediationIfEligible(instance);

  assertEquals(remediateJobCount(), 0);
  const row = driftStatusQueries.getById(instance.id);
  assertExists(row);
  assertEquals(row.lastRemediation.status, 'held_canary');
  assertEquals(row.lastRemediation.trigger, 'auto');
  assertEquals(row.lastRemediation.signature, signature);
  assertEquals(row.lastAutoAttemptSignature, signature);

  // Once per signature: a second refresh does not re-hold (already attempted).
  queueAutoRemediationIfEligible(instance);
  assertEquals(remediateJobCount(), 0);
});

migratedTest('canary: the default canary itself remediates', () => {
  const instance = createInstance('Radarr Canary');
  createInstance('Radarr B');
  seedDrifted(instance);
  enableAuto(instance);
  canarySettingsQueries.update({ enabled: true, defaultCanaryInstanceId: instance.id });

  queueAutoRemediationIfEligible(instance);
  assertEquals(remediateJobCount(), 1);
});

migratedTest('canary: active rollout of the same arr_type → skip, no hold recorded', () => {
  const instance = createInstance('Radarr A');
  seedDrifted(instance);
  enableAuto(instance);
  openRollout('radarr', instance);

  queueAutoRemediationIfEligible(instance);

  assertEquals(remediateJobCount(), 0);
  const row = driftStatusQueries.getById(instance.id);
  assertEquals(row?.lastRemediation.status, null);
  assertEquals(row?.lastAutoAttemptSignature, null);
});

migratedTest('canary: a Sonarr rollout never blocks Radarr (cross-Arr)', () => {
  const radarr = createInstance('Radarr A', 'radarr');
  const sonarr = createInstance('Sonarr A', 'sonarr');
  seedDrifted(radarr);
  enableAuto(radarr);
  openRollout('sonarr', sonarr);

  queueAutoRemediationIfEligible(radarr);
  assertEquals(remediateJobCount(), 1);
});

migratedTest('canary: disabled with a multi-instance cohort → remediate', () => {
  const instance = createInstance('Radarr A');
  createInstance('Radarr B');
  seedDrifted(instance);
  enableAuto(instance);
  canarySettingsQueries.update({ enabled: false });

  queueAutoRemediationIfEligible(instance);
  assertEquals(remediateJobCount(), 1);
});

migratedTest('canary: enabled but cohort == 1 → remediate', () => {
  const instance = createInstance('Radarr A');
  // A Sonarr instance is a different cohort and must not count toward the Radarr cohort size.
  createInstance('Sonarr A', 'sonarr');
  seedDrifted(instance);
  enableAuto(instance);
  canarySettingsQueries.update({ enabled: true });

  queueAutoRemediationIfEligible(instance);
  assertEquals(remediateJobCount(), 1);
});

Deno.test('decideAutoRemediation: pure canary branches', () => {
  const now = new Date().toISOString();
  const signature = driftSignature([QP_DRIFT]);
  assertExists(signature);
  const row = {
    arrInstanceId: 1,
    arrType: 'radarr' as const,
    status: 'drifted' as const,
    reason: null,
    counts: { drifted: 1, missing: 0, unmanaged: 0, prune: 0 },
    driftSignature: signature,
    notifiedSignature: null,
    detectedVersion: null,
    changes: [QP_DRIFT],
    checkedAt: now,
    contentCheckedAt: now,
    durationMs: 1,
    driftDetectedAt: now,
    acknowledgedSignature: null,
    acknowledgedAt: null,
    acknowledgedEntities: [],
    snoozedUntil: null,
    lastRemediation: { trigger: null, status: null, signature: null, at: null, syncHistoryId: null },
    lastAutoAttemptSignature: null,
    createdAt: now,
    updatedAt: now,
  };
  const base = {
    policy: {
      instanceId: 1,
      arrType: 'radarr' as const,
      mode: 'auto' as const,
      allowedSections: ['qualityProfiles' as const],
      updatedAt: now,
    },
    row,
    nowMs: Date.now(),
    sectionsInProgress: [],
    versionAvailable: new Set(['qualityProfiles' as const]),
  };

  assertEquals(
    decideAutoRemediation({ ...base, canary: { ...NO_CANARY, enabled: true, cohortSize: 2 } }).kind,
    'hold_canary'
  );
  assertEquals(
    decideAutoRemediation({ ...base, canary: { ...NO_CANARY, enabled: true, cohortSize: 2, isDefaultCanary: true } })
      .kind,
    'remediate'
  );
  assertEquals(decideAutoRemediation({ ...base, canary: { ...NO_CANARY, activeRolloutForType: true } }), {
    kind: 'skip',
    reason: 'canary_rollout_active',
  });
  assertEquals(decideAutoRemediation({ ...base, canary: NO_CANARY, sectionsInProgress: ['qualityProfiles'] }), {
    kind: 'skip',
    reason: 'sync_in_progress',
  });
  assertEquals(
    decideAutoRemediation({ ...base, canary: NO_CANARY, row: { ...row, lastAutoAttemptSignature: signature } }),
    { kind: 'skip', reason: 'already_attempted' }
  );
  assertEquals(decideAutoRemediation({ ...base, canary: NO_CANARY, row: { ...row, contentCheckedAt: null } }), {
    kind: 'skip',
    reason: 'stale_content',
  });
  assertEquals(decideAutoRemediation({ ...base, canary: NO_CANARY, versionAvailable: new Set() }), {
    kind: 'skip',
    reason: 'no_sections',
  });
});

// ---------------------------------------------------------------------------
// Re-arm on recovery
// ---------------------------------------------------------------------------

function qpPreview(instance: ArrInstance, qualityProfiles: EntityChange[]): GeneratePreviewResult {
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: 0,
    sections: ['qualityProfiles'],
    sectionOutcomes: [{ section: 'qualityProfiles', failure: null, skipped: false }],
    qualityProfiles: { section: 'qualityProfiles', customFormats: [], qualityProfiles },
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
  };
}

async function refresh(instance: ArrInstance, entities: EntityChange[]): Promise<void> {
  const outcome = await checkAndPersistInstance(instance, {
    heartbeat: () => Promise.resolve({ ok: true, version: '5.0.0' }),
    isPcdCacheReady: () => true,
    resolveAvailableSections: () => new Set<SyncPreviewSection>(['qualityProfiles']),
    registerPreviewAttempt: () => true,
    now: () => Date.now(),
    budgetMs: 20_000,
    generatePreview: () => Promise.resolve(qpPreview(instance, entities)),
  });
  assertEquals(outcome.kind, 'ok');
}

migratedTest('re-arm: attempt sig-a → genuine recovery → sig-a again → eligible (remediate)', async () => {
  const instance = createInstance('Radarr A');
  enableAuto(instance);
  const drifting: EntityChange = {
    entityType: QP_DRIFT.entityType,
    name: QP_DRIFT.name,
    action: 'update',
    remoteId: QP_DRIFT.remoteId,
    fields: QP_DRIFT.fields,
  };

  await refresh(instance, [drifting]);
  const sigA = driftStatusQueries.getById(instance.id)?.driftSignature;
  assertExists(sigA);
  assertEquals(driftStatusQueries.markAutoAttempt(instance.id, sigA), true);

  // Genuine recovery: a fresh clean content check clears the per-signature attempt claim.
  await refresh(instance, []);
  const recovered = driftStatusQueries.getById(instance.id);
  assertEquals(recovered?.status, 'in-sync');
  assertEquals(recovered?.lastAutoAttemptSignature, null);

  // The identical drift recurs: it is a new drift event and is eligible again.
  await refresh(instance, [drifting]);
  const recurred = driftStatusQueries.getById(instance.id);
  assertEquals(recurred?.driftSignature, sigA);
  const decision = decideAutoRemediation({
    policy: driftRemediationPolicyQueries.get(instance.id, 'radarr'),
    row: recurred,
    nowMs: Date.now(),
    canary: NO_CANARY,
    sectionsInProgress: [],
    versionAvailable: new Set(['qualityProfiles']),
  });
  assertEquals(decision.kind, 'remediate');
});
