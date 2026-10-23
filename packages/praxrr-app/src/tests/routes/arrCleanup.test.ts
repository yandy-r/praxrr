// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { POST } from '../../routes/api/v1/arr/cleanup/+server.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { MAX_CLEANUP_ITEMS, parseCleanupRequest } from '$lib/server/sync/cleanupRequest.ts';

type PostEvent = Parameters<typeof POST>[0];

function buildPostEvent(rawBody: string): PostEvent {
  const request = new Request('http://localhost/api/v1/arr/cleanup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
  return { request } as PostEvent;
}

/** Fails the test if the route reaches instance lookup (validation must reject first). */
async function postExpectingValidationError(rawBody: string): Promise<Response> {
  const originalGetById = arrInstancesQueries.getById;
  arrInstancesQueries.getById = () => {
    throw new Error('instance lookup must not run for an invalid request');
  };
  try {
    return await POST(buildPostEvent(rawBody));
  } finally {
    arrInstancesQueries.getById = originalGetById;
  }
}

Deno.test('POST /api/v1/arr/cleanup: invalid JSON returns 400', async () => {
  const response = await postExpectingValidationError('{not json');
  assertEquals(response.status, 400);
  const body = (await response.json()) as { error: string };
  assertEquals(body.error, 'Request body must be valid JSON');
});

Deno.test('POST /api/v1/arr/cleanup: non-object body returns 400', async () => {
  const response = await postExpectingValidationError('[1, 2]');
  assertEquals(response.status, 400);
});

Deno.test('POST /api/v1/arr/cleanup: execute with empty scanResult returns 400', async () => {
  const response = await postExpectingValidationError(
    JSON.stringify({ instanceId: 1, action: 'execute', scanResult: {} })
  );
  assertEquals(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert(body.error.startsWith('scanResult must contain'));
});

Deno.test('POST /api/v1/arr/cleanup: keeps existing instanceId and action messages', async () => {
  const missingId = await postExpectingValidationError(JSON.stringify({ action: 'scan' }));
  assertEquals(missingId.status, 400);
  assertEquals(await missingId.json(), { error: 'instanceId is required' });

  for (const instanceId of [1.5, -1]) {
    const invalidId = await postExpectingValidationError(JSON.stringify({ instanceId, action: 'scan' }));
    assertEquals(invalidId.status, 400, `expected 400 for instanceId ${instanceId}`);
    assertEquals(await invalidId.json(), { error: 'instanceId is required' });
  }

  const badAction = await postExpectingValidationError(JSON.stringify({ instanceId: 1, action: 'nuke' }));
  assertEquals(badAction.status, 400);
  assertEquals(await badAction.json(), { error: 'action must be "scan" or "execute"' });

  const missingScan = await postExpectingValidationError(JSON.stringify({ instanceId: 1, action: 'execute' }));
  assertEquals(missingScan.status, 400);
  assertEquals(await missingScan.json(), { error: 'scanResult is required for execute action' });
});

Deno.test('parseCleanupRequest: rejects malformed stale items', () => {
  const base = { instanceId: 1, action: 'execute' };
  const invalidItems: unknown[] = [
    { id: 0, name: 'x', strippedName: 'x' },
    { id: -1, name: 'x', strippedName: 'x' },
    { id: 1.5, name: 'x', strippedName: 'x' },
    { id: '1', name: 'x', strippedName: 'x' },
    { id: 1, name: 2, strippedName: 'x' },
    { id: 1, name: 'x' },
    null,
  ];
  for (const item of invalidItems) {
    const result = parseCleanupRequest({
      ...base,
      scanResult: { staleCustomFormats: [item], staleQualityProfiles: [] },
    });
    assertEquals(result.ok, false, `expected rejection for ${JSON.stringify(item)}`);
  }

  const item = { id: 1, name: 'x', strippedName: 'x' };
  const oversized = parseCleanupRequest({
    ...base,
    scanResult: { staleCustomFormats: [], staleQualityProfiles: Array(MAX_CLEANUP_ITEMS + 1).fill(item) },
  });
  assertEquals(oversized.ok, false);
  const atCap = parseCleanupRequest({
    ...base,
    scanResult: { staleCustomFormats: Array(MAX_CLEANUP_ITEMS).fill(item), staleQualityProfiles: [] },
  });
  assertEquals(atCap.ok, true);

  const valid = parseCleanupRequest({
    ...base,
    scanResult: {
      staleCustomFormats: [{ id: 1, name: 'CF\u200B', strippedName: 'CF', extra: true }],
      staleQualityProfiles: [],
    },
  });
  assertEquals(valid, {
    ok: true,
    request: {
      action: 'execute',
      instanceId: 1,
      includeUnmanaged: false,
      scanResult: { staleCustomFormats: [{ id: 1, name: 'CF\u200B', strippedName: 'CF' }], staleQualityProfiles: [] },
    },
  });
});

Deno.test('parseCleanupRequest: includeUnmanaged defaults to false, accepts booleans, rejects non-booleans', () => {
  const scan = parseCleanupRequest({ instanceId: 1, action: 'scan' });
  assertEquals(scan, { ok: true, request: { action: 'scan', instanceId: 1, includeUnmanaged: false } });

  const scanOptIn = parseCleanupRequest({ instanceId: 1, action: 'scan', includeUnmanaged: true });
  assertEquals(scanOptIn, { ok: true, request: { action: 'scan', instanceId: 1, includeUnmanaged: true } });

  const executeOptIn = parseCleanupRequest({
    instanceId: 1,
    action: 'execute',
    includeUnmanaged: true,
    scanResult: { staleCustomFormats: [], staleQualityProfiles: [] },
  });
  assertEquals(executeOptIn, {
    ok: true,
    request: {
      action: 'execute',
      instanceId: 1,
      includeUnmanaged: true,
      scanResult: { staleCustomFormats: [], staleQualityProfiles: [] },
    },
  });

  for (const includeUnmanaged of ['true', 'false', 1, 0, null, [], {}]) {
    const scanRejected = parseCleanupRequest({ instanceId: 1, action: 'scan', includeUnmanaged });
    assertEquals(scanRejected, {
      ok: false,
      error: 'includeUnmanaged must be a boolean',
    });

    const executeRejected = parseCleanupRequest({
      instanceId: 1,
      action: 'execute',
      includeUnmanaged,
      scanResult: { staleCustomFormats: [], staleQualityProfiles: [] },
    });
    assertEquals(executeRejected, {
      ok: false,
      error: 'includeUnmanaged must be a boolean',
    });
  }
});
