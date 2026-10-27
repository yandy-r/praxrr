// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { POST } from '../../routes/api/v1/arr/cleanup/+server.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { logger } from '$logger/logger.ts';
import type { LogOptions } from '$logger/types.ts';
import { MAX_CLEANUP_ITEMS, parseCleanupRequest } from '$lib/server/sync/cleanupRequest.ts';
import { HttpError } from '$http/types.ts';
import { RadarrClient } from '$utils/arr/clients/radarr.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';

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

Deno.test('POST /api/v1/arr/cleanup: 5xx returns a fixed message and logs the raw error', async () => {
  const secret = 'apikey=sk_live_SECRET123';
  const upstreamBody = JSON.stringify({ message: secret });
  const originalGetById = arrInstancesQueries.getById;
  const originalGetCredentials = arrInstanceCredentialsQueries.getByInstanceId;
  const originalGetQualityProfilesSync = arrSyncQueries.getQualityProfilesSync;
  const originalGetTrashSources = trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance;
  const originalGetCustomFormats = RadarrClient.prototype.getCustomFormats;
  const originalGetQualityProfiles = RadarrClient.prototype.getQualityProfiles;
  const originalLoggerError = logger.error;
  const logged: { message: string; options?: LogOptions }[] = [];
  arrInstancesQueries.getById = () => ({
    id: 1,
    name: 'Test',
    type: 'radarr',
    url: 'http://127.0.0.1:9',
    external_url: null,
    api_key_fingerprint: null,
    api_key: 'key',
    tags: null,
    enabled: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });
  arrInstanceCredentialsQueries.getByInstanceId = () => undefined;
  arrSyncQueries.getQualityProfilesSync = () => ({
    selections: [],
    config: { trigger: 'manual', cron: null, lastSyncedAt: null },
  });
  trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance = () => [];
  RadarrClient.prototype.getCustomFormats = async () => {
    throw new HttpError(`HTTP 500: Internal Server Error | ${upstreamBody}`, 500, JSON.parse(upstreamBody));
  };
  RadarrClient.prototype.getQualityProfiles = async () => [];
  logger.error = async (message: string, options?: LogOptions) => {
    logged.push({ message, options });
  };
  try {
    const response = await POST(buildPostEvent(JSON.stringify({ instanceId: 1, action: 'scan' })));
    assertEquals(response.status, 500);
    const text = await response.text();
    assertEquals(JSON.parse(text), {
      error: 'Cleanup failed. Check the server logs for details.',
      code: 'cleanup_failed',
    });
    assert(!text.includes('SECRET123'), 'response must not contain the raw error text');
    assertEquals(logged.length, 1);
    assertEquals(logged[0].options?.source, 'arr/cleanup');
    assert(JSON.stringify(logged[0].options?.meta, errorReplacer).includes('SECRET123'), 'raw error must be logged');
  } finally {
    arrInstancesQueries.getById = originalGetById;
    arrInstanceCredentialsQueries.getByInstanceId = originalGetCredentials;
    arrSyncQueries.getQualityProfilesSync = originalGetQualityProfilesSync;
    trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance = originalGetTrashSources;
    RadarrClient.prototype.getCustomFormats = originalGetCustomFormats;
    RadarrClient.prototype.getQualityProfiles = originalGetQualityProfiles;
    logger.error = originalLoggerError;
  }
});

function errorReplacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? { name: value.name, message: value.message } : value;
}
