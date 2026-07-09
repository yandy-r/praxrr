import { assertEquals, assertMatch } from '@std/assert';
import { POST as createPreviewPost } from '../../routes/api/v1/sync/preview/+server.ts';
import {
  _handleSyncPreviewApplyRequest,
  POST as applyPreviewPost,
  type SyncPreviewApplyDependencies,
} from '../../routes/api/v1/sync/preview/[previewId]/apply/+server.ts';
import type { components } from '$api/v1.d.ts';
import { arrInstancesQueries, type ArrInstance } from '../../lib/server/db/queries/arrInstances.ts';
import {
  previewStore,
  PREVIEW_STATUS_READY,
  type SyncPreviewCreateInput,
} from '../../lib/server/sync/preview/store.ts';
import {
  PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS,
  PREVIEW_MAX_SNAPSHOTS,
  PREVIEW_REQUEST_BODY_LIMIT_BYTES,
  registerPreviewCreateAttempt,
  resetPreviewCreateRateLimitForTests,
} from '../../lib/server/sync/preview/limits.ts';

const INSTANCE_ID = 7001;
const now = '2026-02-21T00:00:00.000Z';

type ErrorResponse = components['schemas']['ErrorResponse'];
type SyncPreviewApplyResponse = components['schemas']['SyncPreviewApplyResponse'];
type SyncPreviewApplyErrorResponse = components['schemas']['SyncPreviewApplyErrorResponse'];
type SyncJobResult = Awaited<ReturnType<SyncPreviewApplyDependencies['executeSyncJob']>>;

function createArrInstanceFixture(): ArrInstance {
  return {
    id: INSTANCE_ID,
    name: 'Preview Test Instance',
    type: 'radarr',
    url: 'http://radarr.local',
    external_url: null,
    api_key_fingerprint: null,
    api_key: '',
    tags: null,
    enabled: 1,
    source: 'ui',
    created_at: now,
    updated_at: now,
  };
}

function createSnapshotInput(id: string): SyncPreviewCreateInput {
  return {
    id,
    instanceId: INSTANCE_ID,
    instanceName: 'Preview Test Instance',
    arrType: 'radarr',
    status: PREVIEW_STATUS_READY,
    sections: ['qualityProfiles', 'delayProfiles'],
    sectionOutcomes: [
      {
        section: 'qualityProfiles',
        error: null,
        skipped: false,
      },
      {
        section: 'delayProfiles',
        error: 'upstream failed',
        skipped: false,
      },
    ],
    qualityProfiles: null,
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

function createApplyRequest(previewId: string, body: string = '{}'): Request {
  return new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function dependenciesReturning(result: SyncJobResult, nowMs: number = Date.now()): SyncPreviewApplyDependencies {
  return {
    getSectionsInProgress: () => [],
    executeSyncJob: () => Promise.resolve(result),
    now: () => nowMs,
  };
}

Deno.test('sync preview apply success body matches the generated response contract', async () => {
  const previewId = `preview-apply-success-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());
  let execution:
    | {
        instanceId: number;
        sections: readonly string[];
        source: string | undefined;
      }
    | undefined;

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      {
        getSectionsInProgress: () => [],
        executeSyncJob: (instanceId, sections, source) => {
          execution = { instanceId, sections, source };
          return Promise.resolve({ status: 'success', output: 'Synced 2 entities' });
        },
        now: Date.now,
      }
    );

    assertEquals(response.status, 200);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload, {
      success: true,
      results: {
        status: 'success',
        output: 'Synced 2 entities',
      },
      staleWarning: null,
    });
    assertEquals(execution, {
      instanceId: INSTANCE_ID,
      sections: ['qualityProfiles'],
      source: 'manual',
    });
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply skipped body matches the generated success contract', async () => {
  const previewId = `preview-apply-skipped-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      dependenciesReturning({ status: 'skipped', output: 'No changes required' })
    );

    assertEquals(response.status, 200);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload, {
      success: true,
      results: {
        status: 'skipped',
        output: 'No changes required',
      },
      staleWarning: null,
    });
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply failed body matches the generated coarse result contract', async () => {
  const previewId = `preview-apply-job-failed-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      dependenciesReturning({ status: 'failure', error: 'Arr rejected the update' })
    );

    assertEquals(response.status, 500);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload, {
      success: false,
      results: {
        status: 'failure',
        output: '',
        error: 'Arr rejected the update',
      },
      staleWarning: null,
    });
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply includes the stale warning in the generated response shape', async () => {
  const previewId = `preview-apply-stale-warning-${crypto.randomUUID()}`;
  const createdAtMs = Date.now();
  previewStore.create(createSnapshotInput(previewId), createdAtMs);

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      dependenciesReturning({ status: 'success', output: 'Synced' }, createdAtMs + 6 * 60 * 1000 + 30 * 1000)
    );

    assertEquals(response.status, 200);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload.staleWarning, 'Preview is 6 minute(s) old.');
    assertEquals(payload.results.status, 'success');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply stale-blocked body matches the generated error contract', async () => {
  const previewId = `preview-apply-stale-blocked-${crypto.randomUUID()}`;
  const createdAtMs = Date.now();
  previewStore.create(createSnapshotInput(previewId), createdAtMs);
  let executionCount = 0;

  try {
    const response = await _handleSyncPreviewApplyRequest(previewId, createApplyRequest(previewId), {
      getSectionsInProgress: () => [],
      executeSyncJob: () => {
        executionCount++;
        return Promise.resolve({ status: 'success' });
      },
      now: () => createdAtMs + 31 * 60 * 1000,
    });

    assertEquals(response.status, 422);
    const payload = (await response.json()) as SyncPreviewApplyErrorResponse;
    assertEquals(payload, {
      error: 'Preview is older than 30 minutes. Regenerate before applying.',
      staleWarning: 'Preview is 31 minute(s) old.',
    });
    assertEquals(executionCount, 0);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply blocks when preview had section-generation errors', async () => {
  const previewId = `preview-apply-section-errors-${crypto.randomUUID()}`;
  previewStore.create(
    {
      ...createSnapshotInput(previewId),
      error: 'Preview generation completed with 1 section error(s)',
    },
    Date.now()
  );

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sections: ['qualityProfiles'] }),
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 409);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /section-generation errors.*Regenerate/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply rejects explicitly requested ineligible sections', async () => {
  const previewId = `preview-apply-failed-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sections: ['delayProfiles'],
        }),
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 409);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /failed preview generation/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply blocks when no sections were successfully previewed', async () => {
  const previewId = `preview-apply-none-eligible-${crypto.randomUUID()}`;
  previewStore.create(
    {
      ...createSnapshotInput(previewId),
      sectionOutcomes: [
        {
          section: 'qualityProfiles',
          error: 'failed',
          skipped: false,
        },
        {
          section: 'delayProfiles',
          error: null,
          skipped: true,
        },
      ],
    },
    Date.now()
  );

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /No successfully previewed sections/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply rejects oversized request payloads', async () => {
  const previewId = `preview-apply-oversized-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const oversized = 'x'.repeat(PREVIEW_REQUEST_BODY_LIMIT_BYTES + 16);
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: oversized,
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /exceeds .* bytes/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply rejects malformed JSON body', async () => {
  const previewId = `preview-apply-malformed-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"sections": ["qualityProfiles"]',
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as ErrorResponse;
    assertEquals(payload.error, 'Invalid JSON body');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview create rejects oversized request payloads', async () => {
  const oversizedBody = 'x'.repeat(PREVIEW_REQUEST_BODY_LIMIT_BYTES + 16);
  const response = await createPreviewPost({
    request: new Request('http://localhost/api/v1/sync/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversizedBody,
    }),
  } as unknown as Parameters<typeof createPreviewPost>[0]);

  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertMatch(payload.error, /exceeds .* bytes/i);
});

Deno.test('sync preview create enforces per-instance rate limits', async () => {
  const originalGetById = arrInstancesQueries.getById;
  const instance = createArrInstanceFixture();
  resetPreviewCreateRateLimitForTests();

  arrInstancesQueries.getById = ((id: number) =>
    id === instance.id ? instance : undefined) as typeof arrInstancesQueries.getById;

  try {
    const nowMs = Date.now();
    for (let index = 0; index < PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS; index++) {
      registerPreviewCreateAttempt(instance.id, nowMs);
    }

    const response = await createPreviewPost({
      request: new Request('http://localhost/api/v1/sync/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: instance.id }),
      }),
    } as unknown as Parameters<typeof createPreviewPost>[0]);

    assertEquals(response.status, 429);
    const payload = (await response.json()) as { error: string };
    assertMatch(payload.error, /Too many preview requests/i);
  } finally {
    resetPreviewCreateRateLimitForTests();
    arrInstancesQueries.getById = originalGetById;
  }
});

Deno.test('sync preview create enforces preview-store capacity limits', async () => {
  const originalGetById = arrInstancesQueries.getById;
  const instance = createArrInstanceFixture();
  const createdPreviewIds: string[] = [];
  resetPreviewCreateRateLimitForTests();

  arrInstancesQueries.getById = ((id: number) =>
    id === instance.id ? instance : undefined) as typeof arrInstancesQueries.getById;

  try {
    while (previewStore.getSize() < PREVIEW_MAX_SNAPSHOTS) {
      const previewId = `preview-capacity-${crypto.randomUUID()}`;
      createdPreviewIds.push(previewId);
      previewStore.create(createSnapshotInput(previewId), Date.now());
    }

    const response = await createPreviewPost({
      request: new Request('http://localhost/api/v1/sync/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: instance.id }),
      }),
    } as unknown as Parameters<typeof createPreviewPost>[0]);

    assertEquals(response.status, 429);
    const payload = (await response.json()) as { error: string };
    assertMatch(payload.error, /at capacity/i);
  } finally {
    for (const previewId of createdPreviewIds) {
      previewStore.delete(previewId);
    }
    resetPreviewCreateRateLimitForTests();
    arrInstancesQueries.getById = originalGetById;
  }
});
