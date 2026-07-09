import { assertEquals } from '@std/assert';
import { pcdManager, snapshotService } from '$pcd/index.ts';
import type { PcdSnapshotDetail, PcdSnapshotFullDetail } from '$pcd/snapshots/types.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import {
  GET as listSnapshotsRoute,
  POST as createSnapshotRoute,
} from '../../../routes/api/v1/pcd/[databaseId]/snapshots/+server.ts';
import {
  DELETE as deleteSnapshotRoute,
  GET as getSnapshotRoute,
} from '../../../routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts';

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
    name: 'pcd-snapshots-route-db',
    repository_url: 'https://example.com/db.git',
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

Deno.test('snapshot list route validates params and returns paginated results', async () => {
  const restores: Restores = [];
  const dbInstance = buildDatabase(31);
  let capturedListInput: { databaseId: number; type?: string; limit?: number; offset?: number } | null = null;

  patchTarget(pcdManager, 'getById', (() => dbInstance) as typeof pcdManager.getById, restores);

  patchTarget(
    snapshotService,
    'list',
    ((databaseId: number, options?: { type?: 'auto' | 'manual'; limit?: number; offset?: number }) => {
      capturedListInput = {
        databaseId,
        type: options?.type,
        limit: options?.limit,
        offset: options?.offset,
      };
      return {
        snapshots: [],
        total: 0,
      };
    }) as typeof snapshotService.list,
    restores
  );

  try {
    const response = await listSnapshotsRoute({
      params: { databaseId: '31' },
      url: new URL('http://localhost/api/v1/pcd/31/snapshots?type=auto&limit=5&offset=3'),
    } as unknown as Parameters<typeof listSnapshotsRoute>[0]);

    assertEquals(response.status, 200);
    const payload = (await response.json()) as { total: number; snapshots: unknown[] };
    assertEquals(payload.total, 0);
    assertEquals(payload.snapshots, []);
    assertEquals(capturedListInput, { databaseId: 31, type: 'auto', limit: 5, offset: 3 });
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('snapshot create route trims description and delegates to manual snapshot service', async () => {
  const restores: Restores = [];
  const dbInstance = buildDatabase(32);
  let capturedCreateInput: { databaseId: number; description?: string } | null = null;

  patchTarget(pcdManager, 'getById', (() => dbInstance) as typeof pcdManager.getById, restores);

  patchTarget(
    snapshotService,
    'createManualSnapshot',
    (async (input: { databaseId: number; description?: string }) => {
      capturedCreateInput = input;
      return {
        id: 9001,
        databaseId: input.databaseId,
        type: 'manual',
        trigger: 'manual',
        description: input.description ?? null,
        opsSequenceMaxId: 100,
        opsCountBase: 1,
        opsCountUser: 2,
        cacheStateHash: null,
        targetInstanceIds: null,
        createdAt: new Date().toISOString(),
      };
    }) as typeof snapshotService.createManualSnapshot,
    restores
  );

  try {
    const response = await createSnapshotRoute({
      params: { databaseId: '32' },
      request: new Request('http://localhost/api/v1/pcd/32/snapshots', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ description: '  trimmed value  ' }),
      }),
    } as unknown as Parameters<typeof createSnapshotRoute>[0]);

    assertEquals(response.status, 201);
    const payload = (await response.json()) as PcdSnapshotDetail;
    assertEquals(capturedCreateInput, { databaseId: 32, description: 'trimmed value' });
    assertEquals(payload.description, 'trimmed value');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('snapshot detail route returns computed opsWrittenSince and never-restorable flag', async () => {
  const restores: Restores = [];
  const dbInstance = buildDatabase(33);
  const snapshot: PcdSnapshotDetail = {
    id: 7,
    databaseId: 33,
    type: 'auto',
    trigger: 'pull',
    description: null,
    opsSequenceMaxId: 30,
    opsCountBase: 2,
    opsCountUser: 3,
    cacheStateHash: null,
    targetInstanceIds: null,
    createdAt: new Date().toISOString(),
  };

  patchTarget(pcdManager, 'getById', (() => dbInstance) as typeof pcdManager.getById, restores);

  patchTarget(
    snapshotService,
    'getFullDetail',
    (() =>
      Promise.resolve({
        ...snapshot,
        opsWrittenSince: 15,
        isRestorable: false,
      } as PcdSnapshotFullDetail)) as typeof snapshotService.getFullDetail,
    restores
  );

  try {
    const response = await getSnapshotRoute({
      params: { databaseId: '33', snapshotId: '7' },
    } as unknown as Parameters<typeof getSnapshotRoute>[0]);

    assertEquals(response.status, 200);
    const payload = (await response.json()) as {
      id: number;
      opsWrittenSince: number;
      isRestorable: boolean;
    };
    assertEquals(payload.id, 7);
    assertEquals(payload.opsWrittenSince, 15);
    assertEquals(payload.isRestorable, false);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('snapshot create route rejects descriptions over 1000 characters', async () => {
  const restores: Restores = [];
  const dbInstance = buildDatabase(32);
  let createCalled = false;

  patchTarget(pcdManager, 'getById', (() => dbInstance) as typeof pcdManager.getById, restores);

  patchTarget(
    snapshotService,
    'createManualSnapshot',
    (() => {
      createCalled = true;
      return Promise.resolve({
        id: 9010,
        databaseId: 32,
        type: 'manual',
        trigger: 'manual',
        description: 'should-not-run',
        opsSequenceMaxId: 100,
        opsCountBase: 1,
        opsCountUser: 2,
        cacheStateHash: null,
        targetInstanceIds: null,
        createdAt: new Date().toISOString(),
      });
    }) as typeof snapshotService.createManualSnapshot,
    restores
  );

  try {
    const response = await createSnapshotRoute({
      params: { databaseId: '32' },
      request: new Request('http://localhost/api/v1/pcd/32/snapshots', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ description: 'a'.repeat(1001) }),
      }),
    } as unknown as Parameters<typeof createSnapshotRoute>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as { error: string };
    assertEquals(payload.error, 'Description must be 1000 characters or fewer');
    assertEquals(createCalled, false);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('snapshot detail and delete routes enforce database ownership', async () => {
  const restores: Restores = [];
  const dbInstance = buildDatabase(34);
  const snapshot: PcdSnapshotDetail = {
    id: 3,
    databaseId: 999,
    type: 'manual',
    trigger: 'manual',
    description: null,
    opsSequenceMaxId: 1,
    opsCountBase: 0,
    opsCountUser: 0,
    cacheStateHash: null,
    targetInstanceIds: null,
    createdAt: new Date().toISOString(),
  };
  let deleteCalled = false;

  patchTarget(pcdManager, 'getById', (() => dbInstance) as typeof pcdManager.getById, restores);

  patchTarget(snapshotService, 'getDetail', (() => snapshot) as typeof snapshotService.getDetail, restores);

  patchTarget(
    snapshotService,
    'getFullDetail',
    (() =>
      Promise.resolve({
        ...snapshot,
        opsWrittenSince: 0,
        isRestorable: false,
      } as PcdSnapshotFullDetail)) as typeof snapshotService.getFullDetail,
    restores
  );

  patchTarget(
    snapshotService,
    'deleteSnapshot',
    (() => {
      deleteCalled = true;
      return true;
    }) as typeof snapshotService.deleteSnapshot as typeof snapshotService.deleteSnapshot,
    restores
  );

  try {
    const detailResponse = await getSnapshotRoute({
      params: { databaseId: '34', snapshotId: '3' },
    } as unknown as Parameters<typeof getSnapshotRoute>[0]);
    assertEquals(detailResponse.status, 404);

    const deleteResponse = await deleteSnapshotRoute({
      params: { databaseId: '34', snapshotId: '3' },
    } as unknown as Parameters<typeof deleteSnapshotRoute>[0]);
    assertEquals(deleteResponse.status, 404);
    assertEquals(deleteCalled, false);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
