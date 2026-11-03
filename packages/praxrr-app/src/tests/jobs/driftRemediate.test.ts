import { assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { driftRemediationPolicyQueries } from '$db/queries/driftRemediationPolicy.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import { createDriftRemediateHandler, type DriftRemediateDependencies } from '$jobs/handlers/driftRemediate.ts';
import { driftEntityKey, driftSignature } from '$sync/drift/check.ts';
import { entityAcksFor } from '$sync/drift/suppression.ts';
import type { DriftEntityChange, DriftStatus } from '$sync/drift/types.ts';
import type { ApplyReviewedPreviewInput, ApplyReviewedPreviewOutcome } from '$sync/preview/apply.ts';
import type { CreateReviewedPreviewInput, CreateReviewedPreviewOutcome } from '$sync/preview/create.ts';
import type { EntityChange, SyncPreviewResult, SyncPreviewSection } from '$sync/preview/types.ts';

/**
 * `drift.remediate` handler guards (plan §8 "Never writes unless drifted",
 * "Idempotency/concurrency") against a real migrated app DB. Preview create/apply and the
 * post-apply drift re-check are injected, so call counts prove no write path was reached.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/drift-remediate-${crypto.randomUUID()}`;
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QP_ENTITY: EntityChange = {
  entityType: 'qualityProfile',
  name: 'HD-1080p',
  action: 'update',
  remoteId: 7,
  fields: [{ field: 'cutoff', type: 'changed', current: 1, desired: 2 }],
};

const DP_ENTITY: EntityChange = {
  entityType: 'delayProfile',
  name: 'Default',
  action: 'update',
  remoteId: 1,
  fields: [{ field: 'usenetDelay', type: 'changed', current: 0, desired: 60 }],
};

function toDrift(section: SyncPreviewSection, entity: EntityChange): DriftEntityChange {
  return {
    section,
    entityType: entity.entityType,
    name: entity.name,
    action: entity.action as 'update',
    category: 'drift',
    remoteId: entity.remoteId,
    fields: entity.fields,
  };
}

const QP_DRIFT = toDrift('qualityProfiles', QP_ENTITY);
const DP_DRIFT = toDrift('delayProfiles', DP_ENTITY);

function createInstance(name: string): ArrInstance {
  const id = arrInstancesQueries.create({ name, type: 'radarr', url: 'http://localhost:7878', apiKey: 'k' });
  const row = arrInstancesQueries.getById(id);
  assertExists(row);
  return row;
}

interface SeedOptions {
  status?: DriftStatus;
  changes?: DriftEntityChange[];
  contentFresh?: boolean;
}

function seedRow(instance: ArrInstance, options: SeedOptions = {}): string {
  const changes = options.changes ?? [QP_DRIFT];
  const signature = driftSignature(changes);
  assertExists(signature);
  const now = new Date().toISOString();
  driftStatusQueries.upsert({
    arrInstanceId: instance.id,
    arrType: 'radarr',
    status: options.status ?? 'drifted',
    reason: null,
    driftedCount: changes.length,
    missingCount: 0,
    unmanagedCount: 0,
    driftSignature: signature,
    detectedVersion: null,
    changes,
    checkedAt: now,
    contentCheckedAt: options.contentFresh === false ? null : now,
    durationMs: 1,
    driftDetectedAt: now,
  });
  return signature;
}

function enableAuto(instance: ArrInstance, sections: SyncPreviewSection[] = ['qualityProfiles']): void {
  driftRemediationPolicyQueries.upsert({
    instanceId: instance.id,
    arrType: 'radarr',
    mode: 'auto',
    allowedSections: sections,
  });
}

function job(instanceId: number, signature: string): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 9100,
    jobType: 'drift.remediate',
    status: 'running',
    runAt: now,
    payload: { instanceId, driftSignature: signature },
    source: 'system',
    dedupeKey: `drift.remediate:${instanceId}`,
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

interface PreviewParts {
  qualityProfiles?: EntityChange[];
  delayProfile?: EntityChange | null;
}

function preview(instance: ArrInstance, parts: PreviewParts): SyncPreviewResult {
  const sections: SyncPreviewSection[] = [];
  if (parts.qualityProfiles) sections.push('qualityProfiles');
  if (parts.delayProfile !== undefined) sections.push('delayProfiles');
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    instanceId: instance.id,
    instanceName: instance.name,
    arrType: 'radarr',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
    status: 'ready',
    failure: null,
    sections,
    sectionOutcomes: sections.map((section) => ({ section, failure: null, skipped: false })),
    qualityProfiles: parts.qualityProfiles
      ? { section: 'qualityProfiles', customFormats: [], qualityProfiles: parts.qualityProfiles }
      : null,
    delayProfiles: parts.delayProfile !== undefined ? { section: 'delayProfiles', profile: parts.delayProfile } : null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 1, totalDeletes: 0, totalUnchanged: 0 },
    driftRemediation: null,
  };
}

interface Harness {
  deps: DriftRemediateDependencies;
  createCalls: CreateReviewedPreviewInput[];
  applyCalls: { previewId: string; input: ApplyReviewedPreviewInput }[];
  recheckCalls: number;
}

function harness(instance: ArrInstance, parts: PreviewParts = { qualityProfiles: [QP_ENTITY] }): Harness {
  const h: Harness = {
    createCalls: [],
    applyCalls: [],
    recheckCalls: 0,
    deps: {
      createReviewedPreview: (input: CreateReviewedPreviewInput): Promise<CreateReviewedPreviewOutcome> => {
        h.createCalls.push(input);
        return Promise.resolve({ kind: 'ok', preview: preview(instance, parts) });
      },
      applyReviewedPreview: (
        previewId: string,
        input: ApplyReviewedPreviewInput
      ): Promise<ApplyReviewedPreviewOutcome> => {
        h.applyCalls.push({ previewId, input });
        return Promise.resolve({
          kind: 'applied',
          httpStatus: 200,
          response: {
            success: true,
            results: { status: 'success', output: 'ok' },
            staleWarning: null,
            outcomes: [],
            syncHistoryId: null,
          },
        });
      },
      checkAndPersistInstance: () => {
        h.recheckCalls += 1;
        return Promise.resolve();
      },
      now: () => Date.now(),
    },
  };
  return h;
}

function assertNoWrites(h: Harness): void {
  assertEquals(h.createCalls.length, 0);
  assertEquals(h.applyCalls.length, 0);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

Deno.test('drift.remediate handler is registered in the queue registry', () => {
  assertExists(jobQueueRegistry.get('drift.remediate'));
});

// ---------------------------------------------------------------------------
// Never writes unless drifted
// ---------------------------------------------------------------------------

for (const status of ['in-sync', 'error', 'unreachable'] as const) {
  migratedTest(`never writes unless drifted: status ${status} → cancelled, no preview/apply`, async () => {
    const instance = createInstance('Radarr A');
    const signature = seedRow(instance, { status });
    enableAuto(instance);
    const h = harness(instance);

    const result = await createDriftRemediateHandler(h.deps)(job(instance.id, signature));

    assertEquals(result.status, 'cancelled');
    assertNoWrites(h);
    assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, null);
  });
}

migratedTest('never writes unless drifted: stale content → cancelled, no preview/apply', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance, { contentFresh: false });
  enableAuto(instance);
  const h = harness(instance);

  const result = await createDriftRemediateHandler(h.deps)(job(instance.id, signature));

  assertEquals(result.status, 'cancelled');
  assertNoWrites(h);
});

migratedTest('never writes unless drifted: signature moved since enqueue → cancelled', async () => {
  const instance = createInstance('Radarr A');
  seedRow(instance);
  enableAuto(instance);
  const h = harness(instance);

  const result = await createDriftRemediateHandler(h.deps)(job(instance.id, 'feedface'));

  assertEquals(result.status, 'cancelled');
  assertNoWrites(h);
  assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, null);
});

migratedTest('never writes unless drifted: policy turned off since enqueue → cancelled', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  const h = harness(instance);

  const result = await createDriftRemediateHandler(h.deps)(job(instance.id, signature));

  assertEquals(result.status, 'cancelled');
  assertNoWrites(h);
});

migratedTest(
  'never writes unless drifted: preview no longer matches stored drift → cancelled stale, no apply',
  async () => {
    const instance = createInstance('Radarr A');
    const signature = seedRow(instance);
    enableAuto(instance);
    // The live preview now shows a DIFFERENT entity drifting in the same section.
    const h = harness(instance, { qualityProfiles: [{ ...QP_ENTITY, name: 'Other', remoteId: 99 }] });

    const result = await createDriftRemediateHandler(h.deps)(job(instance.id, signature));

    assertEquals(result.status, 'cancelled');
    assertEquals(h.createCalls.length, 1);
    assertEquals(h.applyCalls.length, 0);
    assertEquals(driftStatusQueries.getById(instance.id)?.lastRemediation.status, 'skipped');
  }
);

// ---------------------------------------------------------------------------
// Idempotency / concurrency
// ---------------------------------------------------------------------------

migratedTest('idempotency: a second run for the same signature is already_attempted; apply once', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  enableAuto(instance);
  const h = harness(instance);
  const handler = createDriftRemediateHandler(h.deps);

  const first = await handler(job(instance.id, signature));
  const second = await handler(job(instance.id, signature));

  assertEquals(first.status, 'success');
  assertEquals(second.status, 'cancelled');
  assertEquals(second.decision, 'Not remediated: already_attempted');
  assertEquals(h.applyCalls.length, 1);
  assertEquals(h.applyCalls[0].input.source, 'system');
  assertEquals(h.applyCalls[0].input.principal, null);
  assertEquals(h.applyCalls[0].input.sections, ['qualityProfiles']);
  assertEquals(h.createCalls[0].driftRemediation, {
    instanceId: instance.id,
    driftSignature: signature,
    driftDetectedAt: driftStatusQueries.getById(instance.id)?.driftDetectedAt ?? null,
    trigger: 'auto',
  });
  assertEquals(h.recheckCalls, 1);
  assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, signature);
});

migratedTest('concurrency: two concurrent runs for one signature apply exactly once', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  enableAuto(instance);
  const h = harness(instance);
  const handler = createDriftRemediateHandler(h.deps);

  const results = await Promise.all([handler(job(instance.id, signature)), handler(job(instance.id, signature))]);

  assertEquals(results.map((result) => result.status).sort(), ['cancelled', 'success']);
  assertEquals(h.createCalls.length, 1);
  assertEquals(h.applyCalls.length, 1);
});

migratedTest('concurrency: a target section already syncing → cancelled, signature not claimed', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  enableAuto(instance);
  db.execute(
    `INSERT INTO arr_sync_quality_profiles_config (instance_id, sync_status) VALUES (?, 'in_progress')
     ON CONFLICT(instance_id) DO UPDATE SET sync_status = 'in_progress'`,
    instance.id
  );
  const h = harness(instance);

  const result = await createDriftRemediateHandler(h.deps)(job(instance.id, signature));

  assertEquals(result.status, 'cancelled');
  assertNoWrites(h);
  assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, null);
});

migratedTest('exclusion: a section containing an acknowledged entity is never remediated', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance, { changes: [QP_DRIFT, DP_DRIFT] });
  enableAuto(instance, ['qualityProfiles', 'delayProfiles']);
  const acked = driftStatusQueries.setSuppression(instance.id, signature, {
    acknowledgedSignature: null,
    acknowledgedEntities: entityAcksFor([QP_DRIFT], [driftEntityKey(QP_DRIFT)]),
    snoozedUntil: null,
    acknowledgedAt: new Date().toISOString(),
  });
  assertEquals(acked, true);
  const h = harness(instance, { delayProfile: DP_ENTITY });

  const result = await createDriftRemediateHandler(h.deps)(job(instance.id, signature));

  assertEquals(result.status, 'success');
  assertEquals(h.createCalls[0].sections, ['delayProfiles']);
  assertEquals(h.applyCalls[0].input.sections, ['delayProfiles']);
});

migratedTest('exclusion: a section whose preview contains managed deletes is never applied', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance, { changes: [QP_DRIFT, DP_DRIFT] });
  enableAuto(instance, ['qualityProfiles', 'delayProfiles']);
  const managedDelete: EntityChange = {
    entityType: 'qualityProfile',
    name: 'Legacy',
    action: 'delete',
    remoteId: 3,
    managed: true,
    fields: [],
  };
  const h = harness(instance, { qualityProfiles: [QP_ENTITY, managedDelete], delayProfile: DP_ENTITY });

  const result = await createDriftRemediateHandler(h.deps)(job(instance.id, signature));

  assertEquals(result.status, 'success');
  assertEquals(h.createCalls[0].sections, ['qualityProfiles', 'delayProfiles']);
  assertEquals(h.applyCalls.length, 1);
  assertEquals(h.applyCalls[0].input.sections, ['delayProfiles']);
});

// ---------------------------------------------------------------------------
// Retriable preconditions release the claim; write-started failures keep it
// ---------------------------------------------------------------------------

migratedTest('precondition: preview rejected 429 → claim released, nothing recorded, next run eligible', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  enableAuto(instance);
  const h = harness(instance);
  let rejectCreate = true;
  const ok = h.deps.createReviewedPreview;
  const deps: DriftRemediateDependencies = {
    ...h.deps,
    createReviewedPreview: (input) =>
      rejectCreate ? Promise.resolve({ kind: 'rejected', status: 429, error: 'rate limited' }) : ok(input),
  };
  const handler = createDriftRemediateHandler(deps);

  const first = await handler(job(instance.id, signature));
  assertEquals(first.status, 'cancelled');
  const afterFirst = driftStatusQueries.getById(instance.id);
  assertEquals(afterFirst?.lastAutoAttemptSignature, null);
  assertEquals(afterFirst?.lastRemediation.status, null);
  assertEquals(h.applyCalls.length, 0);
  assertEquals(h.recheckCalls, 0);

  rejectCreate = false;
  const second = await handler(job(instance.id, signature));
  assertEquals(second.status, 'success');
  assertEquals(h.applyCalls.length, 1);
  assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, signature);
});

migratedTest('precondition: apply rejected 409 before execution → claim released', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  enableAuto(instance);
  const h = harness(instance);
  const deps: DriftRemediateDependencies = {
    ...h.deps,
    applyReviewedPreview: () =>
      Promise.resolve({ kind: 'error', httpStatus: 409, body: { error: 'Cannot apply while sync is running' } }),
  };

  const result = await createDriftRemediateHandler(deps)(job(instance.id, signature));

  assertEquals(result.status, 'cancelled');
  assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, null);
  assertEquals(driftStatusQueries.getById(instance.id)?.lastRemediation.status, null);
});

migratedTest('write-started failure: apply ran and failed → claim kept, failed recorded', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  enableAuto(instance);
  const h = harness(instance);
  let applies = 0;
  const deps: DriftRemediateDependencies = {
    ...h.deps,
    applyReviewedPreview: () => {
      applies += 1;
      return Promise.resolve({
        kind: 'applied',
        httpStatus: 500,
        response: {
          success: false,
          results: { status: 'failure', output: 'boom' },
          staleWarning: null,
          outcomes: [],
          syncHistoryId: null,
        },
      });
    },
  };
  const handler = createDriftRemediateHandler(deps);

  const first = await handler(job(instance.id, signature));
  assertEquals(first.status, 'failure');
  const row = driftStatusQueries.getById(instance.id);
  assertEquals(row?.lastAutoAttemptSignature, signature);
  // No history row was linked, so the handler records the failure itself (never stale).
  assertEquals(row?.lastRemediation.status, 'failed');
  assertEquals(row?.lastRemediation.signature, signature);

  const second = await handler(job(instance.id, signature));
  assertEquals(second.status, 'cancelled');
  assertEquals(applies, 1);
});

migratedTest('write-started failure: apply throws → claim kept', async () => {
  const instance = createInstance('Radarr A');
  const signature = seedRow(instance);
  enableAuto(instance);
  const h = harness(instance);
  const deps: DriftRemediateDependencies = {
    ...h.deps,
    applyReviewedPreview: () => Promise.reject(new Error('socket closed mid-write')),
  };

  const result = await createDriftRemediateHandler(deps)(job(instance.id, signature));

  assertEquals(result.status, 'failure');
  assertEquals(driftStatusQueries.getById(instance.id)?.lastAutoAttemptSignature, signature);
  assertEquals(driftStatusQueries.getById(instance.id)?.lastRemediation.status, 'failed');
});
