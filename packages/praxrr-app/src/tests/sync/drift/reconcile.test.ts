import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { arrSyncQueries, type ReviewedSyncClaim } from '$db/queries/arrSync.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import type { ArrInstanceCredentialIdentity } from '$arr/arrInstanceClients.ts';
import type { BaseArrClient } from '$arr/base.ts';
import { executeReviewedSyncJob, type ReviewedSyncExecutionDependencies } from '$jobs/handlers/arrSync.ts';
import { driftSignature } from '$sync/drift/check.ts';
import type { DriftEntityChange } from '$sync/drift/types.ts';
import type { GeneratePreviewResult, GeneratePreviewWithReviewContextResult } from '$sync/preview/orchestrator.ts';
import type { SyncPreviewCreateDependencies } from '$sync/preview/create.ts';
import { resetPreviewCreateRateLimitForTests } from '$sync/preview/limits.ts';
import { previewStore } from '$sync/preview/store.ts';
import type {
  SyncPreviewPreparedExecutionContext,
  SyncPreviewResult,
  SyncPreviewSection,
  SyncPreviewSectionMaterializedEvidence,
} from '$sync/preview/types.ts';
import type { SectionHandler, SectionType } from '$sync/types.ts';
import { _handleDriftReconcileRequest } from '../../../routes/api/v1/drift/[instanceId]/reconcile/+server.ts';
import { _handleSyncPreviewCreateRequest } from '../../../routes/api/v1/sync/preview/+server.ts';
import { _handleSyncPreviewApplyRequest } from '../../../routes/api/v1/sync/preview/[previewId]/apply/+server.ts';

/**
 * AC1 (plan §8 "Reconcile records linked history"): reconcile → drift-tagged reviewed preview →
 * apply through the real route + real `executeReviewedSyncJob` (Arr I/O stubbed) → linked
 * `sync_history` row and a `last_remediation_*` back-pointer at the exact instance.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/drift-reconcile-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);
      resetPreviewCreateRateLimitForTests();

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        resetPreviewCreateRateLimitForTests();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

const DATABASE_ID = 41;
const DETECTED_AT = '2026-11-02T08:00:00.000Z';
/** Stable per-instance credential identity (fingerprints are unique per instance). */
function credentialFor(instance: Pick<ArrInstance, 'id'>): ArrInstanceCredentialIdentity {
  return { fingerprint: `credential-${instance.id}`, keyVersion: 'legacy', revision: 'r1' };
}

function createConfiguredInstance(name: string): ArrInstance {
  const id = arrInstancesQueries.create({
    name,
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
    apiKeyFingerprint: `fingerprint-${name}`,
  });
  // qualityProfiles + delayProfiles configured; mediaManagement deliberately NOT configured.
  arrSyncQueries.saveQualityProfilesSync(id, [{ databaseId: DATABASE_ID, profileName: 'HD-1080p' }], {
    trigger: 'manual',
    cron: null,
  });
  arrSyncQueries.saveDelayProfilesSync(id, {
    databaseId: DATABASE_ID,
    profileName: 'Default Delay',
    trigger: 'manual',
    cron: null,
  });
  const row = arrInstancesQueries.getById(id);
  assertExists(row);
  return row;
}

/**
 * Stored drift: a managed qualityProfiles drift, an unmanaged-only delayProfiles change (not
 * reconcilable), and a mediaManagement drift on an unconfigured section (not reconcilable).
 */
function driftChanges(): DriftEntityChange[] {
  return [
    {
      section: 'qualityProfiles',
      entityType: 'qualityProfile',
      name: 'HD-1080p',
      action: 'update',
      category: 'drift',
      remoteId: 7,
      fields: [{ field: 'cutoff', type: 'changed', current: 1, desired: 2 }],
    },
    {
      section: 'delayProfiles',
      entityType: 'delayProfile',
      name: 'Hand-made',
      action: 'delete',
      category: 'unmanaged',
      remoteId: 3,
      fields: [],
    },
    {
      section: 'mediaManagement',
      entityType: 'naming',
      name: 'naming',
      action: 'update',
      category: 'drift',
      remoteId: null,
      fields: [{ field: 'renameMovies', type: 'changed', current: false, desired: true }],
    },
  ];
}

function seedDriftedRow(instance: ArrInstance): string {
  const changes = driftChanges();
  const signature = driftSignature(changes);
  assertExists(signature);
  driftStatusQueries.upsert({
    arrInstanceId: instance.id,
    arrType: 'radarr',
    status: 'drifted',
    reason: null,
    driftedCount: 2,
    missingCount: 0,
    unmanagedCount: 1,
    driftSignature: signature,
    detectedVersion: '5.14.0.9383',
    changes,
    checkedAt: DETECTED_AT,
    contentCheckedAt: DETECTED_AT,
    durationMs: 12,
    driftDetectedAt: DETECTED_AT,
  });
  return signature;
}

function evidenceFor(section: SyncPreviewSection): SyncPreviewSectionMaterializedEvidence {
  return { section, pcd: { revision: 1 }, arr: { revision: 1 }, plan: { section, action: 'update' } };
}

function preparedFor(section: SyncPreviewSection): SyncPreviewPreparedExecutionContext {
  return Object.freeze({
    section,
    config: {},
    desired: { name: `${section}-reviewed` },
    materialPlan: { section },
    currentGuards: { revision: 1 },
  });
}

/** Deterministic reviewed materialization for the requested sections (create and execute). */
function materialize(instance: ArrInstance, sections: readonly SectionType[]): GeneratePreviewWithReviewContextResult {
  const preview: GeneratePreviewResult = {
    instanceId: instance.id,
    instanceName: instance.name,
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: Date.now(),
    sections: [...sections],
    sectionOutcomes: sections.map((section) => ({ section, failure: null, skipped: false })),
    qualityProfiles: sections.includes('qualityProfiles')
      ? {
          section: 'qualityProfiles',
          customFormats: [],
          qualityProfiles: [
            {
              entityType: 'qualityProfile',
              name: 'HD-1080p',
              action: 'update',
              remoteId: 7,
              fields: [{ field: 'cutoff', type: 'changed', current: 1, desired: 2 }],
            },
          ],
        }
      : null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 1, totalDeletes: 0, totalUnchanged: 0 },
  };
  return {
    preview,
    reviewContext: {
      sectionConfigs: {},
      evidence: sections.map(evidenceFor),
      preparedExecutionContexts: Object.fromEntries(sections.map((section) => [section, preparedFor(section)])),
    },
  };
}

const fakeClient = { close: () => undefined } as unknown as BaseArrClient;

function createDependencies(generatedSections: SectionType[][]): SyncPreviewCreateDependencies {
  return {
    generatePreview: (input) => {
      generatedSections.push([...(input.sections ?? [])]);
      return Promise.resolve(materialize(input.instance, input.sections ?? []));
    },
    getInstanceById: (id) => arrInstancesQueries.getById(id),
    getReviewClient: (_type, instance) =>
      Promise.resolve({ client: fakeClient, credentialIdentity: credentialFor(instance) }),
    now: Date.now,
  };
}

/** Real reviewed executor with only the Arr/claim boundary stubbed; history + drift writes are real. */
function reviewedExecutionDependencies(writes: SectionType[]): Partial<ReviewedSyncExecutionDependencies> {
  const handler = (section: SectionType): SectionHandler =>
    ({
      type: section,
      hasConfig: () => true,
      createSyncer: () => ({
        setPreparedExecutionContext: () => undefined,
        clearPreparedExecutionContext: () => undefined,
        clearPreviewConfig: () => undefined,
        sync: () => {
          writes.push(section);
          return Promise.resolve({ success: true, itemsSynced: 1, outcomes: [] });
        },
      }),
    }) as unknown as SectionHandler;

  return {
    getReviewClient: (instance) => Promise.resolve({ client: fakeClient, credentialIdentity: credentialFor(instance) }),
    detectVersion: () => Promise.resolve(null),
    claimSections: (instanceId, sections) =>
      Object.freeze({ instanceId, sections: [...sections] }) as ReviewedSyncClaim,
    releaseSections: () => true,
    completeSections: () => true,
    failSections: () => true,
    materializeReview: (instance, sections) => Promise.resolve(materialize(instance, sections)),
    createSnapshot: () => Promise.resolve(null),
    getSectionHandler: handler,
  };
}

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

migratedTest('Reconcile records linked history', async () => {
  db.execute(
    'INSERT INTO database_instances (id, uuid, name, repository_url, local_path) VALUES (?, ?, ?, ?, ?)',
    DATABASE_ID,
    'db-uuid',
    'Reconcile DB',
    'https://example.invalid/db.git',
    '/tmp/praxrr-tests/reconcile-db'
  );
  const bystander = createConfiguredInstance('Bystander Radarr');
  const target = createConfiguredInstance('Target Radarr');
  const bystanderSignature = seedDriftedRow(bystander);
  const signature = seedDriftedRow(target);

  const generatedSections: SectionType[][] = [];
  const createdIds: string[] = [];
  try {
    // A client-supplied driftRemediation on the public create route is ignored (server-owned).
    const forgedCreate = await _handleSyncPreviewCreateRequest(
      postJson('http://localhost/api/v1/sync/preview', {
        instanceId: target.id,
        sections: ['qualityProfiles'],
        driftRemediation: { instanceId: target.id, driftSignature: signature, driftDetectedAt: null, trigger: 'auto' },
      }),
      createDependencies(generatedSections)
    );
    assertEquals(forgedCreate.status, 200);
    const forgedPreview = (await forgedCreate.json()) as SyncPreviewResult;
    createdIds.push(forgedPreview.id);
    assertEquals(forgedPreview.driftRemediation, null);
    assertEquals(previewStore.get(forgedPreview.id)?.driftRemediation, null);

    // Narrowing to a non-drifted section never widens the reconcile set.
    const widened = await _handleDriftReconcileRequest(
      String(target.id),
      postJson(`http://localhost/api/v1/drift/${target.id}/reconcile`, { sections: ['mediaManagement'] }),
      createDependencies(generatedSections)
    );
    assertEquals(widened.status, 400);

    // Reconcile: sections == drifted ∩ configured ∩ available; body-supplied link is ignored.
    generatedSections.length = 0;
    const reconcile = await _handleDriftReconcileRequest(
      String(target.id),
      postJson(`http://localhost/api/v1/drift/${target.id}/reconcile`, {
        driftRemediation: {
          instanceId: bystander.id,
          driftSignature: 'forged',
          driftDetectedAt: null,
          trigger: 'auto',
        },
      }),
      createDependencies(generatedSections)
    );
    assertEquals(reconcile.status, 200);
    const preview = (await reconcile.json()) as SyncPreviewResult;
    createdIds.push(preview.id);
    assertEquals(generatedSections, [['qualityProfiles']]);
    assertEquals(preview.instanceId, target.id);
    assertEquals(preview.sections, ['qualityProfiles']);
    assertEquals(preview.driftRemediation, {
      instanceId: target.id,
      driftSignature: signature,
      driftDetectedAt: DETECTED_AT,
      trigger: 'reconcile',
    });

    // Apply through the existing route with the real reviewed executor.
    const writes: SectionType[] = [];
    const apply = await _handleSyncPreviewApplyRequest(
      preview.id,
      postJson(`http://localhost/api/v1/sync/preview/${preview.id}/apply`, {
        driftRemediation: {
          instanceId: bystander.id,
          driftSignature: 'forged',
          driftDetectedAt: null,
          trigger: 'auto',
        },
      }),
      {
        getSectionsInProgress: () => [],
        executeReviewedSyncJob: (input) =>
          executeReviewedSyncJob({ ...input, dependencies: reviewedExecutionDependencies(writes) }),
        now: Date.now,
      }
    );
    assertEquals(apply.status, 200);
    const applied = (await apply.json()) as { success: boolean; syncHistoryId: number | null };
    assertEquals(applied.success, true);
    assertEquals(writes, ['qualityProfiles']);
    assertExists(applied.syncHistoryId);

    const history = syncHistoryQueries.getById(applied.syncHistoryId);
    assertExists(history);
    assertEquals(history.arrInstanceId, target.id);
    assertEquals(history.previewId, preview.id);
    assertEquals(history.driftSignature, signature);
    assertEquals(history.driftDetectedAt, DETECTED_AT);
    assertEquals(history.remediationTrigger, 'reconcile');

    // Back-pointer lands on the exact instance_id only.
    const targetRow = driftStatusQueries.getById(target.id);
    assertExists(targetRow);
    assertEquals(targetRow.lastRemediation.trigger, 'reconcile');
    assertEquals(targetRow.lastRemediation.status, 'success');
    assertEquals(targetRow.lastRemediation.signature, signature);
    assertEquals(targetRow.lastRemediation.syncHistoryId, applied.syncHistoryId);
    assert(targetRow.lastRemediation.at !== null);

    const bystanderRow = driftStatusQueries.getById(bystander.id);
    assertExists(bystanderRow);
    assertEquals(bystanderRow.driftSignature, bystanderSignature);
    assertEquals(bystanderRow.lastRemediation, {
      trigger: null,
      status: null,
      signature: null,
      at: null,
      syncHistoryId: null,
    });
  } finally {
    for (const id of createdIds) previewStore.delete(id);
  }
});

migratedTest('Reconcile rejects instances that are not drifted or have stale content', async () => {
  db.execute(
    'INSERT INTO database_instances (id, uuid, name, repository_url, local_path) VALUES (?, ?, ?, ?, ?)',
    DATABASE_ID,
    'db-uuid',
    'Reconcile DB',
    'https://example.invalid/db.git',
    '/tmp/praxrr-tests/reconcile-db'
  );
  const instance = createConfiguredInstance('Clean Radarr');
  const generatedSections: SectionType[][] = [];
  const url = `http://localhost/api/v1/drift/${instance.id}/reconcile`;

  const neverChecked = await _handleDriftReconcileRequest(
    String(instance.id),
    postJson(url, {}),
    createDependencies(generatedSections)
  );
  assertEquals(neverChecked.status, 409);

  driftStatusQueries.upsert({
    arrInstanceId: instance.id,
    arrType: 'radarr',
    status: 'drifted',
    reason: null,
    driftedCount: 2,
    missingCount: 0,
    unmanagedCount: 1,
    driftSignature: driftSignature(driftChanges()),
    detectedVersion: '5.14.0.9383',
    changes: driftChanges(),
    checkedAt: DETECTED_AT,
    contentCheckedAt: null,
    durationMs: 12,
    driftDetectedAt: DETECTED_AT,
  });
  const stale = await _handleDriftReconcileRequest(
    String(instance.id),
    postJson(url, {}),
    createDependencies(generatedSections)
  );
  assertEquals(stale.status, 409);
  assertEquals(generatedSections, []);
});
