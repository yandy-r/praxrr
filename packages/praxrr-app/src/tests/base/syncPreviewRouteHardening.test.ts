import { assertEquals, assertMatch } from '@std/assert';
import { POST as createPreviewPost } from '../../routes/api/v1/sync/preview/+server.ts';
import { POST as applyPreviewPost } from '../../routes/api/v1/sync/preview/[previewId]/apply/+server.ts';
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

Deno.test('sync preview apply rejects explicitly requested failed sections', async () => {
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
    const payload = (await response.json()) as { error: string };
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
    const payload = (await response.json()) as { error: string };
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
    const payload = (await response.json()) as { error: string };
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
    const payload = (await response.json()) as { error: string };
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
