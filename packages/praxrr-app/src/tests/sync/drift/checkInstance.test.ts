import { assert, assertEquals, assertExists } from '@std/assert';
import { checkInstanceDrift, type DriftCheckDeps } from '$sync/drift/check.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { GeneratePreviewInput, GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type { EntityChange, SyncPreviewSection } from '$sync/preview/types.ts';

// ============================================================================
// Fixtures — everything with I/O is injected; no network, no DB, no real timers
// (except the budget branch, which deliberately exercises real setTimeout).
// ============================================================================

const FIXED_MS = Date.parse('2026-07-08T12:00:00.000Z');
const FIXED_ISO = new Date(FIXED_MS).toISOString();
const VERSION = '5.2.0';

function makeInstance(over: Partial<ArrInstance> = {}): ArrInstance {
  return {
    id: 1,
    name: 'Radarr Main',
    type: 'radarr',
    url: 'http://localhost:7878',
    external_url: null,
    api_key_fingerprint: null,
    api_key: 'test-key',
    tags: null,
    enabled: 1,
    created_at: '2026-07-08T00:00:00.000Z',
    updated_at: '2026-07-08T00:00:00.000Z',
    ...over,
  };
}

function entity(over: Partial<EntityChange> = {}): EntityChange {
  return {
    entityType: 'customFormat',
    name: 'HDR',
    action: 'unchanged',
    remoteId: null,
    fields: [],
    ...over,
  };
}

/** Builds a `GeneratePreviewResult`. Defaults to a compared-but-clean qualityProfiles section. */
function makePreview(over: Partial<GeneratePreviewResult> = {}): GeneratePreviewResult {
  return {
    instanceId: 1,
    instanceName: 'Radarr Main',
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: FIXED_MS,
    sections: ['qualityProfiles'],
    sectionOutcomes: [{ section: 'qualityProfiles', error: null, skipped: false }],
    qualityProfiles: { section: 'qualityProfiles', customFormats: [], qualityProfiles: [] },
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
    errors: [],
    ...over,
  };
}

/** Happy-path deps; every field the module can reach for I/O is stubbed. Overrides win. */
function baseDeps(over: Partial<DriftCheckDeps> = {}): Partial<DriftCheckDeps> {
  return {
    heartbeat: () => Promise.resolve({ ok: true, version: VERSION, appName: 'Radarr' }),
    isPcdCacheReady: () => true,
    resolveAvailableSections: () => new Set<SyncPreviewSection>(['qualityProfiles']),
    registerPreviewAttempt: () => true,
    generatePreview: () => Promise.resolve(makePreview()),
    now: () => FIXED_MS,
    budgetMs: 20_000,
    ...over,
  };
}

// ============================================================================
// Heartbeat branches
// ============================================================================

Deno.test('heartbeat {ok:false,status:401} → unauthorized, no preview, no throw', async () => {
  let previewCalled = false;
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({
      heartbeat: () => Promise.resolve({ ok: false, status: 401 }),
      generatePreview: () => {
        previewCalled = true;
        return Promise.resolve(makePreview());
      },
    })
  );

  assertEquals(result.status, 'unauthorized');
  assertEquals(result.reason, 'unauthorized');
  assertEquals(previewCalled, false); // heartbeat short-circuits: no preview, no notify path reached
  assertEquals(result.detectedVersion, null);
  assertEquals(result.counts, { drifted: 0, missing: 0, unmanaged: 0 });
  assertEquals(result.changes, []);
  assertEquals(result.driftSignature, null);
  assertEquals(result.contentCheckedAt, null);
  assertEquals(result.checkedAt, FIXED_ISO); // deterministic via injected now()
});

Deno.test('heartbeat {ok:false,status:403} → unauthorized', async () => {
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ heartbeat: () => Promise.resolve({ ok: false, status: 403 }) })
  );
  assertEquals(result.status, 'unauthorized');
  assertEquals(result.reason, 'unauthorized');
});

Deno.test('heartbeat {ok:false} (undefined status) → unreachable / timeout', async () => {
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ heartbeat: () => Promise.resolve({ ok: false }) })
  );
  assertEquals(result.status, 'unreachable');
  assertEquals(result.reason, 'timeout');
  assertEquals(result.detectedVersion, null);
  assertEquals(result.contentCheckedAt, null);
  assertEquals(result.checkedAt, FIXED_ISO);
});

Deno.test('heartbeat {ok:false,status:500} → error / invalid_response', async () => {
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ heartbeat: () => Promise.resolve({ ok: false, status: 500 }) })
  );
  assertEquals(result.status, 'error');
  assertEquals(result.reason, 'invalid_response');
});

Deno.test('heartbeat throws → error / error, never rejects', async () => {
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({
      heartbeat: () => {
        throw new Error('boom');
      },
    })
  );
  assertEquals(result.status, 'error');
  assertEquals(result.reason, 'error');
});

// ============================================================================
// Gate branches (heartbeat OK)
// ============================================================================

Deno.test('registerPreviewAttempt=false → error / rate_limited (version carried)', async () => {
  let previewCalled = false;
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({
      registerPreviewAttempt: () => false,
      generatePreview: () => {
        previewCalled = true;
        return Promise.resolve(makePreview());
      },
    })
  );
  assertEquals(result.status, 'error');
  assertEquals(result.reason, 'rate_limited');
  assertEquals(result.detectedVersion, VERSION);
  assertEquals(previewCalled, false);
  assertEquals(result.contentCheckedAt, null);
});

Deno.test('isPcdCacheReady=false → error / cache_not_ready (version carried)', async () => {
  let previewCalled = false;
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({
      isPcdCacheReady: () => false,
      generatePreview: () => {
        previewCalled = true;
        return Promise.resolve(makePreview());
      },
    })
  );
  assertEquals(result.status, 'error');
  assertEquals(result.reason, 'cache_not_ready');
  assertEquals(result.detectedVersion, VERSION);
  assertEquals(previewCalled, false);
  assertEquals(result.contentCheckedAt, null);
});

Deno.test('resolveAvailableSections=∅ → in-sync / not_configured', async () => {
  let previewCalled = false;
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({
      resolveAvailableSections: () => new Set<SyncPreviewSection>(),
      generatePreview: () => {
        previewCalled = true;
        return Promise.resolve(makePreview());
      },
    })
  );
  assertEquals(result.status, 'in-sync');
  assertEquals(result.reason, 'not_configured');
  assertEquals(result.detectedVersion, VERSION);
  assertEquals(previewCalled, false); // empty universe short-circuits before preview
  assertEquals(result.contentCheckedAt, FIXED_ISO);
});

// ============================================================================
// Preview / aggregation branches
// ============================================================================

Deno.test('generatePreview drift fixtures → drifted (update+create counted, signature set)', async () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [
        entity({
          entityType: 'customFormat',
          name: 'HDR',
          action: 'update',
          remoteId: 10,
          fields: [{ field: 'score', type: 'changed', current: 5, desired: 10 }],
        }),
        entity({ entityType: 'customFormat', name: 'DV', action: 'unchanged', remoteId: 11 }),
      ],
      qualityProfiles: [entity({ entityType: 'qualityProfile', name: 'HD-1080p', action: 'create', remoteId: null })],
    },
  });

  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ generatePreview: () => Promise.resolve(preview) })
  );

  assertEquals(result.status, 'drifted');
  assertEquals(result.reason, null);
  assertEquals(result.counts, { drifted: 1, missing: 1, unmanaged: 0 });
  assertEquals(result.changes.length, 2); // 'unchanged' entity is never emitted
  assertEquals(result.detectedVersion, VERSION);
  assertEquals(result.contentCheckedAt, FIXED_ISO);
  assertExists(result.driftSignature);
  // 'unchanged' entities are dropped upstream; only the update+create survive.
  assertEquals(result.changes.map((c) => c.action).sort(), ['create', 'update']);
});

Deno.test('clean preview (compared, no changes) → in-sync', async () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [entity({ name: 'HDR', action: 'unchanged', remoteId: 10 })],
      qualityProfiles: [],
    },
  });
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ generatePreview: () => Promise.resolve(preview) })
  );

  assertEquals(result.status, 'in-sync');
  assertEquals(result.reason, null);
  assertEquals(result.counts, { drifted: 0, missing: 0, unmanaged: 0 });
  assertEquals(result.changes, []);
  assertEquals(result.driftSignature, null);
  assertEquals(result.contentCheckedAt, FIXED_ISO);
});

Deno.test('unmanaged-only preview → in-sync (delete does not count as drift)', async () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [],
      qualityProfiles: [entity({ entityType: 'qualityProfile', name: 'Stray', action: 'delete', remoteId: 99 })],
    },
  });
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ generatePreview: () => Promise.resolve(preview) })
  );

  assertEquals(result.status, 'in-sync');
  assertEquals(result.reason, null);
  assertEquals(result.counts, { drifted: 0, missing: 0, unmanaged: 1 });
  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0].category, 'unmanaged');
  assertEquals(result.driftSignature, null); // delete excluded from signature
  assertEquals(result.contentCheckedAt, FIXED_ISO);
});

Deno.test('throwing generatePreview → error / error (version carried, never rejects)', async () => {
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({
      generatePreview: () => {
        throw new Error('preview blew up');
      },
    })
  );
  assertEquals(result.status, 'error');
  assertEquals(result.reason, 'error');
  assertEquals(result.detectedVersion, VERSION);
  assertEquals(result.contentCheckedAt, null);
});

Deno.test('all available sections errored → error / invalid_response', async () => {
  const preview = makePreview({
    qualityProfiles: null,
    sectionOutcomes: [{ section: 'qualityProfiles', error: 'HTTP 500', skipped: false }],
  });
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ generatePreview: () => Promise.resolve(preview) })
  );

  assertEquals(result.status, 'error');
  assertEquals(result.reason, 'invalid_response');
  assertEquals(result.detectedVersion, VERSION);
});

Deno.test('all available sections skipped (none errored, none compared) → in-sync / not_configured', async () => {
  const preview = makePreview({
    qualityProfiles: null,
    sectionOutcomes: [{ section: 'qualityProfiles', error: null, skipped: true }],
  });
  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({ generatePreview: () => Promise.resolve(preview) })
  );

  assertEquals(result.status, 'in-sync');
  assertEquals(result.reason, 'not_configured');
  assertEquals(result.contentCheckedAt, FIXED_ISO);
});

// ============================================================================
// DC-7 — a 'degraded' (not 'unavailable') section stays in the compared universe.
// resolveAvailableSections returns it; assert it reaches generatePreview and its
// drift is aggregated (never silently dropped).
// ============================================================================

Deno.test('DC-7: degraded section is still compared (forwarded to preview + aggregated)', async () => {
  let capturedSections: readonly string[] = [];
  const preview = makePreview({
    sections: ['qualityProfiles', 'delayProfiles'],
    sectionOutcomes: [
      { section: 'qualityProfiles', error: null, skipped: false },
      { section: 'delayProfiles', error: null, skipped: false },
    ],
    delayProfiles: {
      section: 'delayProfiles',
      profile: entity({
        entityType: 'delayProfile',
        name: 'Default',
        action: 'update',
        remoteId: 1,
        fields: [{ field: 'usenetDelay', type: 'changed', current: 0, desired: 30 }],
      }),
    },
  });

  const result = await checkInstanceDrift(
    makeInstance(),
    baseDeps({
      // The resolver includes 'delayProfiles' as a degraded-but-available section.
      resolveAvailableSections: () => new Set<SyncPreviewSection>(['qualityProfiles', 'delayProfiles']),
      generatePreview: (input: GeneratePreviewInput) => {
        capturedSections = (input.sections ?? []) as readonly string[];
        return Promise.resolve(preview);
      },
    })
  );

  // The degraded section survived version-gating and reached the preview universe.
  assert(capturedSections.includes('delayProfiles'));
  assert(capturedSections.includes('qualityProfiles'));
  // ...and its drift was aggregated rather than dropped.
  assertEquals(result.status, 'drifted');
  assertEquals(result.counts.drifted, 1);
  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0].section, 'delayProfiles');
});

// ============================================================================
// Ineligible arr type is short-circuited, not trusted.
// ============================================================================

Deno.test('non-sync-preview arr type → error / error', async () => {
  let heartbeatCalled = false;
  const result = await checkInstanceDrift(
    makeInstance({ type: 'all' }),
    baseDeps({
      heartbeat: () => {
        heartbeatCalled = true;
        return Promise.resolve({ ok: true, version: VERSION });
      },
    })
  );
  assertEquals(result.status, 'error');
  assertEquals(result.reason, 'error');
  assertEquals(heartbeatCalled, false); // gated before any I/O
});

// ============================================================================
// Budget branch — REAL timers: a slow preview loses the race to a tiny budget.
// sanitizeOps/Resources disabled because the slow work timer outlives the check.
// ============================================================================

Deno.test(
  {
    name: 'slow generatePreview exceeds budget → error / timeout (budget branch)',
    sanitizeOps: false,
    sanitizeResources: false,
  },
  async () => {
    let slowTimer: number | undefined;
    const slowPreview: DriftCheckDeps['generatePreview'] = () =>
      new Promise<GeneratePreviewResult>((resolve) => {
        slowTimer = setTimeout(() => resolve(makePreview()), 200);
      });

    const result = await checkInstanceDrift(
      makeInstance(),
      baseDeps({ budgetMs: 20, generatePreview: slowPreview, now: () => FIXED_MS })
    );

    if (slowTimer !== undefined) {
      clearTimeout(slowTimer);
    }

    assertEquals(result.status, 'error');
    assertEquals(result.reason, 'timeout');
    assertEquals(result.detectedVersion, VERSION);
    assertEquals(result.contentCheckedAt, null);
    assertEquals(result.checkedAt, FIXED_ISO); // now() still makes checkedAt deterministic
  }
);
