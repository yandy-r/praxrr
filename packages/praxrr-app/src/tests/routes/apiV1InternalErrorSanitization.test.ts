// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

/**
 * YAN-1685: non-Arr `/api/v1/**` routes must return a fixed message plus a stable `code` on 5xx and
 * log the raw error through the sanitizing logger, while 4xx validation messages stay unchanged.
 */

import { assert, assertEquals } from '@std/assert';
import { userInterfacePreferencesQueries } from '$db/queries/user_interface_preferences.ts';
import { pcdManager, snapshotService } from '$pcd/index.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import type { PcdSnapshotDetail } from '$pcd/snapshots/types.ts';
import { RollbackPostVerifyError, RollbackStaleError } from '$pcd/snapshots/rollback/types.ts';
import { previewStore } from '$sync/preview/store.ts';
import { db } from '$db/db.ts';
import { appInfoQueries } from '$db/queries/appInfo.ts';
import { internalErrorResponse } from '$http/internalError.ts';
import { logger } from '$logger/logger.ts';
import type { LogOptions } from '$logger/types.ts';
import { API_TOKEN_SCOPES } from '$shared/auth/apiTokenScopes.ts';
import { CF_SCORING } from '$shared/disclosure/sectionKeys.ts';
import { GET as getUiPreference, PATCH as patchUiPreference } from '../../routes/api/v1/ui-preferences/+server.ts';
import { POST as executeRollback } from '../../routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/rollback/+server.ts';
import { DELETE as deletePreview, GET as getPreview } from '../../routes/api/v1/sync/preview/[previewId]/+server.ts';
import { GET as getHealth } from '../../routes/api/v1/health/+server.ts';
import { toErrorBody } from '../../routes/api/v1/trash-guide/sources/_helpers.ts';
import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';

type Restore = () => void;

const SECRET = 'apikey=sk_live_SECRET123';
const SECRET_MARKER = 'SECRET123';

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function restoreAll(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

/** Capture `logger.error` calls instead of writing them; returns the captured entries. */
function captureErrorLogs(restores: Restore[]): { message: string; options?: LogOptions }[] {
  const logged: { message: string; options?: LogOptions }[] = [];
  patchTarget(
    logger,
    'error',
    (async (message: string, options?: LogOptions) => {
      logged.push({ message, options });
    }) as typeof logger.error,
    restores
  );
  return logged;
}

/** True when a captured log entry carries the raw error (so the detail is preserved server-side). */
function loggedRawError(logged: { options?: LogOptions }[]): boolean {
  return logged.some((entry) => {
    const error = (entry.options?.meta as Record<string, unknown> | undefined)?.error;
    const text = error instanceof Error ? error.message : String(error);
    return text.includes(SECRET_MARKER);
  });
}

async function assertSanitized(
  response: Response,
  expected: { status: number; code: string }
): Promise<Record<string, unknown>> {
  const text = await response.text();
  assertEquals(response.status, expected.status);
  assert(!text.includes(SECRET_MARKER), `response leaked raw error text: ${text}`);
  const body = JSON.parse(text) as Record<string, unknown>;
  assertEquals(body.code, expected.code);
  assert(typeof body.error === 'string' && body.error.length > 0);
  return body;
}

function sessionLocals(userId: number): App.Locals {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      password_hash: 'hash',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    session: null,
    authBypass: false,
    principal: { kind: 'session', scopes: API_TOKEN_SCOPES },
  } as App.Locals;
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

Deno.test('internalErrorResponse returns a fixed message + code and logs the raw error', async () => {
  const restores: Restore[] = [];
  const logged = captureErrorLogs(restores);
  try {
    const response = await internalErrorResponse(new Error(SECRET), {
      message: 'Something failed.',
      code: 'preference_read_failed',
      source: 'test',
    });
    const body = await assertSanitized(response, { status: 500, code: 'preference_read_failed' });
    assertEquals(body.error, 'Something failed.');
    assert(loggedRawError(logged));
  } finally {
    restoreAll(restores);
  }
});

// ---------------------------------------------------------------------------
// ui-preferences
// ---------------------------------------------------------------------------

Deno.test('ui-preferences GET 5xx hides the raw read error', async () => {
  const restores: Restore[] = [];
  const logged = captureErrorLogs(restores);
  patchTarget(
    userInterfacePreferencesQueries,
    'getByUserIdAndSectionKey',
    () => {
      throw new Error(`SQLITE_ERROR near ${SECRET}`);
    },
    restores
  );
  try {
    const response = await getUiPreference({
      url: new URL(`http://localhost/api/v1/ui-preferences?section_key=${encodeURIComponent(CF_SCORING)}`),
      locals: sessionLocals(168501),
    } as Parameters<typeof getUiPreference>[0]);
    await assertSanitized(response, { status: 500, code: 'preference_read_failed' });
    assert(loggedRawError(logged));
  } finally {
    restoreAll(restores);
  }
});

Deno.test('ui-preferences PATCH 5xx hides the raw save error; 4xx validation text is unchanged', async () => {
  const restores: Restore[] = [];
  const logged = captureErrorLogs(restores);
  patchTarget(userInterfacePreferencesQueries, 'getByUserIdAndSectionKey', () => undefined, restores);
  patchTarget(
    userInterfacePreferencesQueries,
    'upsert',
    () => {
      throw new Error(`disk I/O error: ${SECRET}`);
    },
    restores
  );
  const patchEvent = (body: Record<string, unknown>, userId: number) =>
    ({
      request: new Request('http://localhost/api/v1/ui-preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      locals: sessionLocals(userId),
    }) as Parameters<typeof patchUiPreference>[0];
  try {
    const failed = await patchUiPreference(patchEvent({ section_key: CF_SCORING, mode: 'advanced' }, 168502));
    await assertSanitized(failed, { status: 500, code: 'preference_save_failed' });
    assert(loggedRawError(logged));

    const invalid = await patchUiPreference(patchEvent({ section_key: CF_SCORING, mode: 'expert' }, 168503));
    assertEquals(invalid.status, 400);
    assertEquals((await invalid.json()).error, 'mode is required and must be "basic" or "advanced"');
  } finally {
    restoreAll(restores);
  }
});

// ---------------------------------------------------------------------------
// Snapshot rollback
// ---------------------------------------------------------------------------

function rollbackDatabase(): DatabaseInstance {
  return { id: 5, name: 'rollback-db', enabled: 1 } as unknown as DatabaseInstance;
}

function rollbackSnapshot(): PcdSnapshotDetail {
  return { id: 9, databaseId: 5 } as unknown as PcdSnapshotDetail;
}

function rollbackEvent(): Parameters<typeof executeRollback>[0] {
  return {
    params: { databaseId: '5', snapshotId: '9' },
    request: new Request('http://localhost/rollback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedCurrentStateHash: 'current-hash' }),
    }),
  } as unknown as Parameters<typeof executeRollback>[0];
}

for (const [label, thrown, code] of [
  [
    'post-verify',
    new RollbackPostVerifyError(`fingerprint mismatch at /data/${SECRET}`),
    'rollback_post_verify_failed',
  ],
  ['unexpected', new Error(`ENOENT: open '/data/${SECRET}'`), 'rollback_failed'],
] as const) {
  Deno.test(`snapshot rollback ${label} 5xx hides the raw error`, async () => {
    const restores: Restore[] = [];
    const logged = captureErrorLogs(restores);
    patchTarget(pcdManager, 'getById', (() => rollbackDatabase()) as typeof pcdManager.getById, restores);
    patchTarget(snapshotService, 'getDetail', (() => rollbackSnapshot()) as typeof snapshotService.getDetail, restores);
    patchTarget(
      snapshotService,
      'restore',
      (async () => {
        throw thrown;
      }) as typeof snapshotService.restore,
      restores
    );
    try {
      await assertSanitized(await executeRollback(rollbackEvent()), { status: 500, code });
      assert(loggedRawError(logged));
    } finally {
      restoreAll(restores);
    }
  });
}

Deno.test('snapshot rollback 4xx stale error keeps its specific message', async () => {
  const restores: Restore[] = [];
  patchTarget(pcdManager, 'getById', (() => rollbackDatabase()) as typeof pcdManager.getById, restores);
  patchTarget(snapshotService, 'getDetail', (() => rollbackSnapshot()) as typeof snapshotService.getDetail, restores);
  patchTarget(
    snapshotService,
    'restore',
    (async () => {
      throw new RollbackStaleError('PCD state changed since preview');
    }) as typeof snapshotService.restore,
    restores
  );
  try {
    const response = await executeRollback(rollbackEvent());
    assertEquals(response.status, 422);
    assertEquals((await response.json()).error, 'PCD state changed since preview');
  } finally {
    restoreAll(restores);
  }
});

// ---------------------------------------------------------------------------
// Sync preview
// ---------------------------------------------------------------------------

Deno.test('sync preview GET/DELETE 5xx hide the raw store error', async () => {
  const restores: Restore[] = [];
  const logged = captureErrorLogs(restores);
  patchTarget(
    previewStore,
    'cleanup',
    (() => {
      throw new Error(`store corrupted: ${SECRET}`);
    }) as typeof previewStore.cleanup,
    restores
  );
  const event = { params: { previewId: 'preview-1' } } as unknown as Parameters<typeof getPreview>[0];
  try {
    await assertSanitized(await getPreview(event), { status: 500, code: 'preview_read_failed' });
    await assertSanitized(await deletePreview(event as Parameters<typeof deletePreview>[0]), {
      status: 500,
      code: 'preview_delete_failed',
    });
    assert(loggedRawError(logged));
  } finally {
    restoreAll(restores);
  }
});

// ---------------------------------------------------------------------------
// TRaSH Guide sources
// ---------------------------------------------------------------------------

Deno.test('TRaSH source error body hides raw text on 5xx and keeps 4xx messages', () => {
  const raw = new Error(`fetch https://user:${SECRET}@example.invalid/repo failed`);
  const internal = toErrorBody(raw, 500);
  assertEquals(internal.code, 'trash_guide_request_failed');
  assert(!internal.error.includes(SECRET_MARKER));

  const upstream = toErrorBody(raw, 502);
  assertEquals(upstream.code, 'trash_guide_upstream_failed');
  assert(!upstream.error.includes(SECRET_MARKER));

  const notFound = toErrorBody(new TrashGuideSourceNotFoundError(7), 404);
  assertEquals(notFound.code, undefined);
  assertEquals(notFound.error, new TrashGuideSourceNotFoundError(7).message);
});

// ---------------------------------------------------------------------------
// Health (unauthenticated)
// ---------------------------------------------------------------------------

Deno.test('health check failures report a fixed message instead of the raw error', async () => {
  const restores: Restore[] = [];
  const logged = captureErrorLogs(restores);
  patchTarget(appInfoQueries, 'getVersion', (() => 'test') as typeof appInfoQueries.getVersion, restores);
  patchTarget(
    db,
    'queryFirst',
    (() => {
      throw new Error(`unable to open database file /data/${SECRET}/praxrr.db`);
    }) as typeof db.queryFirst,
    restores
  );
  try {
    const response = await getHealth({
      url: new URL('http://localhost/api/v1/health'),
    } as Parameters<typeof getHealth>[0]);
    const text = await response.text();
    assertEquals(response.status, 503);
    assert(!text.includes(SECRET_MARKER), `health response leaked raw error text: ${text}`);
    const body = JSON.parse(text) as { components: { sqlite: { status: string; message: string } } };
    assertEquals(body.components.sqlite.status, 'unhealthy');
    assertEquals(body.components.sqlite.message, 'Database query failed');
    // The logger call is fire-and-forget; let it settle before inspecting captures.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(loggedRawError(logged));
  } finally {
    restoreAll(restores);
  }
});
