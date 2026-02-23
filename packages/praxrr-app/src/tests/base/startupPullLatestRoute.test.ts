import { assertEquals } from '@std/assert';
import { db } from '../../lib/server/db/db.ts';
import { GET } from '../../routes/api/v1/system/startup-pull/latest/+server.ts';

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: unknown,
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement as T[K];
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('startup latest endpoint returns 404 when no startup runs exist', async () => {
  const restores: Restore[] = [];

  patchTarget(db, 'queryFirst', () => undefined, restores);

  try {
    const response = await (GET as () => Promise<Response>)();
    const payload = (await response.json()) as { error: string };

    assertEquals(response.status, 404);
    assertEquals(payload, { error: 'No startup pull runs found' });
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup latest endpoint returns mapped startup pull run fields', async () => {
  const restores: Restore[] = [];

  const summary = {
    id: 'run-2026-01-01',
    status: 'success' as const,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:02.000Z',
    imported: 1,
    skippedDefault: 0,
    skippedNoMatch: 2,
    conflicted: 0,
    failed: 1,
    instancesTotal: 1,
    instancesFailed: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    instances: [
      {
        id: 77,
        instanceId: 10,
        instanceName: 'radarr-main',
        arrType: 'radarr',
        status: 'failure' as const,
        imported: 0,
        skippedDefault: 0,
        skippedNoMatch: 1,
        conflicted: 0,
        failed: 1,
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ],
  };

  patchTarget(
    db,
    'queryFirst',
    () =>
      ({
        id: summary.id,
        status: summary.status,
        started_at: summary.startedAt,
        finished_at: summary.finishedAt,
        imported: summary.imported,
        skipped_default: summary.skippedDefault,
        skipped_no_match: summary.skippedNoMatch,
        conflicted: summary.conflicted,
        failed: summary.failed,
        instances_total: summary.instancesTotal,
        instances_failed: summary.instancesFailed,
        created_at: summary.createdAt,
      }) as {
        id: string;
        status: string;
        started_at: string;
        finished_at: string | null;
        imported: number;
        skipped_default: number;
        skipped_no_match: number;
        conflicted: number;
        failed: number;
        instances_total: number;
        instances_failed: number;
        created_at: string;
      },
    restores
  );
  patchTarget(
    db,
    'query',
    () =>
      summary.instances.map((instance) => ({
        id: instance.id,
        run_id: summary.id,
        instance_id: instance.instanceId,
        instance_name: instance.instanceName,
        arr_type: instance.arrType,
        status: instance.status,
        imported: instance.imported,
        skipped_default: instance.skippedDefault,
        skipped_no_match: instance.skippedNoMatch,
        conflicted: instance.conflicted,
        failed: instance.failed,
        created_at: instance.createdAt,
      })),
    restores
  );

  try {
    const response = await (GET as () => Promise<Response>)();
    const payload = (await response.json()) as typeof summary;

    assertEquals(response.status, 200);
    assertEquals(payload, summary);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup latest endpoint returns 500 when query layer throws', async () => {
  const restores: Restore[] = [];

  patchTarget(
    db,
    'queryFirst',
    () => {
      throw new Error('database broken');
    },
    restores
  );

  try {
    const response = await (GET as () => Promise<Response>)();
    const payload = (await response.json()) as { error: string };

    assertEquals(response.status, 500);
    assertEquals(payload, { error: 'Unable to fetch latest startup pull run.' });
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
