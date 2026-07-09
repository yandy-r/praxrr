import { assertEquals } from '@std/assert';
import { pcdManager, snapshotService } from '$pcd/index.ts';
import type { PcdSnapshotDetail } from '$pcd/snapshots/types.ts';
import type { RollbackPreview, RollbackResult } from '$pcd/snapshots/rollback/types.ts';
import { RollbackStaleError, RollbackUnverifiableError } from '$pcd/snapshots/rollback/types.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { GET as previewRoute } from '../../../routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/rollback/preview/+server.ts';
import { POST as executeRoute } from '../../../routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/rollback/+server.ts';

type Restore = () => void;
type Restores = Restore[];

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restores
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function buildDatabase(databaseId: number): DatabaseInstance {
  return {
    id: databaseId,
    uuid: crypto.randomUUID(),
    name: 'rollback-route-db',
    repository_url: '',
    local_path: '/tmp/pcd',
    sync_strategy: 0,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    has_personal_access_token: 0,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function snapshotDetail(id: number, databaseId: number): PcdSnapshotDetail {
  return {
    id,
    databaseId,
    type: 'manual',
    trigger: 'manual',
    description: null,
    opsSequenceMaxId: 10,
    opsCountBase: 1,
    opsCountUser: 1,
    cacheStateHash: 'hash',
    targetInstanceIds: null,
    createdAt: new Date().toISOString(),
  };
}

function previewFixture(databaseId: number, snapshotId: number): RollbackPreview {
  return {
    databaseId,
    snapshotId,
    reconstructable: true,
    reason: null,
    currentStateHash: 'current-hash',
    snapshotStateHash: 'hash',
    opsWrittenSince: 2,
    sections: [],
    summary: { totalCreates: 0, totalUpdates: 1, totalDeletes: 0, totalUnchanged: 3 },
  };
}

function postEvent(databaseId: string, snapshotId: string, body: unknown) {
  return {
    params: { databaseId, snapshotId },
    request: new Request('http://localhost/rollback', {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof executeRoute>[0];
}

Deno.test('rollback preview route returns 200 with the preview payload', async () => {
  const restores: Restores = [];
  patchTarget(pcdManager, 'getById', (() => buildDatabase(5)) as typeof pcdManager.getById, restores);
  patchTarget(snapshotService, 'getDetail', (() => snapshotDetail(9, 5)) as typeof snapshotService.getDetail, restores);
  patchTarget(
    snapshotService,
    'previewRestore',
    (async () => previewFixture(5, 9)) as typeof snapshotService.previewRestore,
    restores
  );

  try {
    const response = await previewRoute({
      params: { databaseId: '5', snapshotId: '9' },
    } as unknown as Parameters<typeof previewRoute>[0]);
    assertEquals(response.status, 200);
    const payload = (await response.json()) as RollbackPreview;
    assertEquals(payload.reconstructable, true);
    assertEquals(payload.summary.totalUpdates, 1);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('rollback preview route returns 404 when the snapshot belongs to another database', async () => {
  const restores: Restores = [];
  patchTarget(pcdManager, 'getById', (() => buildDatabase(5)) as typeof pcdManager.getById, restores);
  patchTarget(
    snapshotService,
    'getDetail',
    (() => snapshotDetail(9, 999)) as typeof snapshotService.getDetail,
    restores
  );

  try {
    const response = await previewRoute({
      params: { databaseId: '5', snapshotId: '9' },
    } as unknown as Parameters<typeof previewRoute>[0]);
    assertEquals(response.status, 404);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('rollback execute route returns 200 on success', async () => {
  const restores: Restores = [];
  patchTarget(pcdManager, 'getById', (() => buildDatabase(5)) as typeof pcdManager.getById, restores);
  patchTarget(snapshotService, 'getDetail', (() => snapshotDetail(9, 5)) as typeof snapshotService.getDetail, restores);
  const result: RollbackResult = {
    rollbackId: 1,
    snapshotId: 9,
    databaseId: 5,
    status: 'success',
    opsUndone: 2,
    opsReactivated: 0,
    preRollbackSnapshotId: 20,
    targetStateHash: 'hash',
    postVerified: true,
    error: null,
    createdAt: new Date().toISOString(),
  };
  patchTarget(snapshotService, 'restore', (async () => result) as typeof snapshotService.restore, restores);

  try {
    const response = await executeRoute(postEvent('5', '9', { expectedCurrentStateHash: 'current-hash' }));
    assertEquals(response.status, 200);
    const payload = (await response.json()) as RollbackResult;
    assertEquals(payload.status, 'success');
    assertEquals(payload.opsUndone, 2);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('rollback execute route returns 400 when expectedCurrentStateHash is missing', async () => {
  const restores: Restores = [];
  patchTarget(pcdManager, 'getById', (() => buildDatabase(5)) as typeof pcdManager.getById, restores);

  try {
    const response = await executeRoute(postEvent('5', '9', {}));
    assertEquals(response.status, 400);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('rollback execute route maps RollbackStaleError to 422', async () => {
  const restores: Restores = [];
  patchTarget(pcdManager, 'getById', (() => buildDatabase(5)) as typeof pcdManager.getById, restores);
  patchTarget(snapshotService, 'getDetail', (() => snapshotDetail(9, 5)) as typeof snapshotService.getDetail, restores);
  patchTarget(
    snapshotService,
    'restore',
    (async () => {
      throw new RollbackStaleError('state changed');
    }) as typeof snapshotService.restore,
    restores
  );

  try {
    const response = await executeRoute(postEvent('5', '9', { expectedCurrentStateHash: 'stale' }));
    assertEquals(response.status, 422);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('rollback execute route maps RollbackUnverifiableError to 409', async () => {
  const restores: Restores = [];
  patchTarget(pcdManager, 'getById', (() => buildDatabase(5)) as typeof pcdManager.getById, restores);
  patchTarget(snapshotService, 'getDetail', (() => snapshotDetail(9, 5)) as typeof snapshotService.getDetail, restores);
  patchTarget(
    snapshotService,
    'restore',
    (async () => {
      throw new RollbackUnverifiableError('cannot reconstruct');
    }) as typeof snapshotService.restore,
    restores
  );

  try {
    const response = await executeRoute(postEvent('5', '9', { expectedCurrentStateHash: 'x' }));
    assertEquals(response.status, 409);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
