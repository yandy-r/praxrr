import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { buildPreviewFailure } from '$sync/preview/failureReason.ts';
import { buildSyncPreviewReviewBinding } from '$sync/preview/reviewBinding.ts';
import {
  PREVIEW_STATUS_APPLIED,
  PREVIEW_STATUS_APPLYING,
  PREVIEW_STATUS_FAILED,
  PREVIEW_STATUS_GENERATING,
  PREVIEW_STATUS_READY,
  type SyncPreviewCreateInput,
  type SyncPreviewGenerationPatch,
  SyncPreviewStore,
} from '$sync/preview/store.ts';
import type { SyncPreviewReviewBinding, SyncPreviewSection, SyncPreviewStatus } from '$sync/preview/types.ts';

const NOW_MS = Date.parse('2026-07-10T00:00:00.000Z');
const INSTANCE_ID = 234;
const SECTIONS: readonly SyncPreviewSection[] = ['qualityProfiles', 'delayProfiles'];

function previewInput(id: string, status: SyncPreviewStatus = PREVIEW_STATUS_GENERATING): SyncPreviewCreateInput {
  return {
    id,
    instanceId: INSTANCE_ID,
    instanceName: 'Reviewed Radarr',
    arrType: 'radarr',
    status,
    failure: null,
    sections: SECTIONS,
    sectionOutcomes: SECTIONS.map((section) => ({
      section,
      failure: null,
      skipped: false,
    })),
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: {
      totalCreates: 1,
      totalUpdates: 0,
      totalDeletes: 0,
      totalUnchanged: 0,
    },
  };
}

function completionPatch(): SyncPreviewGenerationPatch {
  return {
    sections: SECTIONS,
    sectionOutcomes: SECTIONS.map((section) => ({
      section,
      failure: null,
      skipped: false,
    })),
    summary: {
      totalCreates: 1,
      totalUpdates: 0,
      totalDeletes: 0,
      totalUnchanged: 0,
    },
  };
}

async function binding(
  sections: readonly SyncPreviewSection[] = SECTIONS,
  sectionConfigs: Readonly<Partial<Record<SyncPreviewSection, unknown>>> = {
    qualityProfiles: { selected: ['HD-1080p'], nested: { enabled: true } },
  }
): Promise<SyncPreviewReviewBinding> {
  return await buildSyncPreviewReviewBinding({
    instanceId: INSTANCE_ID,
    arrType: 'radarr',
    sections,
    sectionConfigs,
    evidence: sections.map((section) => ({
      section,
      pcd: { section, desired: 'v1' },
      arr: { section, current: 'v1' },
      plan: { section, action: 'update' },
    })),
  });
}

async function readyStore(id = `preview-${crypto.randomUUID()}`, ttlMs = 10_000) {
  const store = new SyncPreviewStore({ ttlMs });
  const created = store.create(previewInput(id), NOW_MS);
  const completed = store.completeGeneration(id, completionPatch(), await binding(), NOW_MS + 1);
  if (!completed) throw new Error('fixture completion failed');
  return { store, id, created, completed };
}

Deno.test('preview store completes generation atomically with a private immutable binding', async () => {
  const store = new SyncPreviewStore({ ttlMs: 10_000 });
  const id = `preview-complete-${crypto.randomUUID()}`;
  const created = store.create(previewInput(id), NOW_MS);
  const sourceConfig = { qualityProfiles: { nested: { enabled: true } } };
  const reviewBinding = await binding(SECTIONS, sourceConfig);

  const completed = store.completeGeneration(id, completionPatch(), reviewBinding, NOW_MS + 5);
  assertEquals(completed?.status, PREVIEW_STATUS_READY);
  assertEquals(completed?.createdAt, created.createdAt);
  assertEquals(completed?.expiresAt, created.expiresAt);

  const publicSnapshot = store.get(id, NOW_MS + 6)!;
  const serialized = JSON.stringify(publicSnapshot);
  assertEquals(serialized.includes('pcdHash'), false);
  assertEquals(serialized.includes('sectionConfigs'), false);

  sourceConfig.qualityProfiles.nested.enabled = false;
  const claim = store.claimReadyForApply(id, ['qualityProfiles'], NOW_MS + 7);
  assertEquals(claim.ok, true);
  if (!claim.ok) return;
  assertEquals(claim.binding.sectionConfigs.qualityProfiles, {
    nested: { enabled: true },
  });
  assertEquals(Object.isFrozen(claim.binding), true);
  assertEquals(Object.isFrozen(claim.binding.sectionConfigs), true);
  assertEquals(Object.isFrozen(claim.binding.sectionConfigs.qualityProfiles as object), true);
  assertThrows(() => {
    const config = claim.binding.sectionConfigs.qualityProfiles as {
      nested: { enabled: boolean };
    };
    config.nested.enabled = false;
  });
  assertEquals(store.releaseApplyClaim(claim.receipt, NOW_MS + 8)?.status, PREVIEW_STATUS_READY);
});

Deno.test('generation completion rejects malformed or mismatched bindings without a partial ready state', async () => {
  const store = new SyncPreviewStore();
  const id = `preview-invalid-binding-${crypto.randomUUID()}`;
  store.create(previewInput(id), NOW_MS);
  const unknownVersion = {
    ...(await binding()),
    version: 2,
  } as unknown as SyncPreviewReviewBinding;

  assertThrows(
    () => store.completeGeneration(id, completionPatch(), unknownVersion, NOW_MS + 1),
    TypeError,
    'Invalid sync preview review binding'
  );
  assertEquals(store.get(id, NOW_MS + 2)?.status, PREVIEW_STATUS_GENERATING);

  const mismatched = await buildSyncPreviewReviewBinding({
    instanceId: INSTANCE_ID + 1,
    arrType: 'radarr',
    sections: SECTIONS,
    evidence: SECTIONS.map((section) => ({
      section,
      pcd: {},
      arr: {},
      plan: {},
    })),
  });
  assertThrows(() => store.completeGeneration(id, completionPatch(), mismatched, NOW_MS + 3));
  assertEquals(store.get(id, NOW_MS + 4)?.status, PREVIEW_STATUS_GENERATING);
});

Deno.test('apply claim fails closed for every pre-claim lifecycle and binding branch', async () => {
  const missingStore = new SyncPreviewStore();
  assertEquals(missingStore.claimReadyForApply('missing', ['qualityProfiles'], NOW_MS), {
    ok: false,
    reason: 'not_found',
  });

  const generatingStore = new SyncPreviewStore();
  generatingStore.create(previewInput('generating'), NOW_MS);
  assertEquals(generatingStore.claimReadyForApply('generating', ['qualityProfiles'], NOW_MS + 1), {
    ok: false,
    reason: 'invalid_state',
    status: PREVIEW_STATUS_GENERATING,
  });

  const legacyStore = new SyncPreviewStore();
  legacyStore.create(previewInput('legacy-ready', PREVIEW_STATUS_READY), NOW_MS);
  assertEquals(legacyStore.claimReadyForApply('legacy-ready', ['qualityProfiles'], NOW_MS + 1), {
    ok: false,
    reason: 'unverifiable_review',
  });
  assertEquals(legacyStore.get('legacy-ready', NOW_MS + 2)?.status, PREVIEW_STATUS_READY);

  const { store, id } = await readyStore();
  for (const invalidSubset of [
    [],
    ['mediaManagement'],
    ['qualityProfiles', 'qualityProfiles'],
  ] as readonly SyncPreviewSection[][]) {
    assertEquals(store.claimReadyForApply(id, invalidSubset, NOW_MS + 2), {
      ok: false,
      reason: 'scope_drift',
    });
    assertEquals(store.get(id, NOW_MS + 2)?.status, PREVIEW_STATUS_READY);
  }

  const expiring = await readyStore('expires-before-claim', 10);
  assertEquals(expiring.store.claimReadyForApply(expiring.id, ['qualityProfiles'], NOW_MS + 10), {
    ok: false,
    reason: 'expired',
  });
  assertEquals(expiring.store.get(expiring.id, NOW_MS + 10), null);
});

Deno.test('duplicate apply claims conflict and receipt-checked release cannot be reused', async () => {
  const { store, id } = await readyStore();
  const first = store.claimReadyForApply(id, ['delayProfiles', 'qualityProfiles'], NOW_MS + 2);
  assertEquals(first.ok, true);
  if (!first.ok) return;
  assertEquals(first.sections, ['delayProfiles', 'qualityProfiles']);
  assertEquals(first.snapshot.status, PREVIEW_STATUS_APPLYING);

  assertEquals(store.claimReadyForApply(id, ['qualityProfiles'], NOW_MS + 3), {
    ok: false,
    reason: 'invalid_state',
    status: PREVIEW_STATUS_APPLYING,
  });
  assertEquals(store.releaseApplyClaim(first.receipt, NOW_MS + 4)?.status, PREVIEW_STATUS_READY);
  assertEquals(store.releaseApplyClaim(first.receipt, NOW_MS + 5), null);

  const second = store.claimReadyForApply(id, ['qualityProfiles'], NOW_MS + 6);
  assertEquals(second.ok, true);
  if (!second.ok) return;
  assertEquals(store.completeApplyClaim(first.receipt, { status: PREVIEW_STATUS_APPLIED }, NOW_MS + 7), null);
  assertEquals(store.get(id, NOW_MS + 7)?.status, PREVIEW_STATUS_APPLYING);
  assertEquals(store.releaseApplyClaim(second.receipt, NOW_MS + 8)?.status, PREVIEW_STATUS_READY);
});

Deno.test(
  'receipt-checked terminal completion covers success, evidence invalidation, and execution failure',
  async () => {
    const cases = [
      { name: 'success', status: PREVIEW_STATUS_APPLIED, failure: undefined },
      {
        name: 'evidence invalidation',
        status: PREVIEW_STATUS_FAILED,
        failure: buildPreviewFailure('stale', 'radarr'),
      },
      {
        name: 'execution failure',
        status: PREVIEW_STATUS_FAILED,
        failure: buildPreviewFailure('executionFailed', 'radarr'),
      },
    ] as const;

    for (const testCase of cases) {
      const { store, id } = await readyStore(`preview-${testCase.name}`);
      const claim = store.claimReadyForApply(id, ['qualityProfiles'], NOW_MS + 2);
      assertEquals(claim.ok, true);
      if (!claim.ok) continue;

      const completed = store.completeApplyClaim(
        claim.receipt,
        { status: testCase.status, failure: testCase.failure },
        NOW_MS + 3
      );
      assertEquals(completed?.status, testCase.status);
      assertEquals(completed?.failure, testCase.failure ?? null);
      assertEquals(store.get(id, NOW_MS + 4)?.status, testCase.status);
      assertEquals(store.completeApplyClaim(claim.receipt, { status: testCase.status }, NOW_MS + 5), null);
    }
  }
);

Deno.test('apply exceptions and TTL expiry cannot strand a preview in applying', async () => {
  const exceptional = await readyStore('preview-exception');
  const claim = exceptional.store.claimReadyForApply(exceptional.id, ['qualityProfiles'], NOW_MS + 2);
  assertEquals(claim.ok, true);
  if (!claim.ok) return;

  await assertRejects(async () => {
    try {
      throw new Error('executor exploded');
    } finally {
      exceptional.store.completeApplyClaim(
        claim.receipt,
        { status: PREVIEW_STATUS_FAILED, failure: buildPreviewFailure('internalError', 'radarr') },
        NOW_MS + 3
      );
    }
  });
  assertEquals(exceptional.store.get(exceptional.id, NOW_MS + 4)?.status, PREVIEW_STATUS_FAILED);

  const expiring = await readyStore('preview-expiring-while-applying', 10);
  const expiringClaim = expiring.store.claimReadyForApply(expiring.id, ['qualityProfiles'], NOW_MS + 2);
  assertEquals(expiringClaim.ok, true);
  if (!expiringClaim.ok) return;
  assertEquals(
    expiring.store.completeApplyClaim(
      expiringClaim.receipt,
      { status: PREVIEW_STATUS_FAILED, failure: buildPreviewFailure('stale', 'radarr') },
      NOW_MS + 10
    ),
    null
  );
  assertEquals(expiring.store.get(expiring.id, NOW_MS + 10), null);
});

Deno.test('generic id-only updates cannot enter or finish receipt-owned applying state', async () => {
  const { store, id } = await readyStore();
  assertThrows(
    () => store.transition(id, PREVIEW_STATUS_APPLYING, NOW_MS + 2),
    Error,
    'requires an apply claim receipt'
  );
  assertEquals(store.get(id, NOW_MS + 2)?.status, PREVIEW_STATUS_READY);

  const claim = store.claimReadyForApply(id, ['qualityProfiles'], NOW_MS + 3);
  assertEquals(claim.ok, true);
  if (!claim.ok) return;
  assertThrows(() => store.transition(id, PREVIEW_STATUS_FAILED, NOW_MS + 4));
  assertEquals(store.get(id, NOW_MS + 4)?.status, PREVIEW_STATUS_APPLYING);
  assertEquals(
    store.completeApplyClaim(
      claim.receipt,
      {
        status: PREVIEW_STATUS_FAILED,
        failure: buildPreviewFailure('internalError', 'radarr'),
      },
      NOW_MS + 5
    )?.status,
    PREVIEW_STATUS_FAILED
  );
});
