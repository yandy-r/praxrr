// T4: GET /api/v1/pcd/{databaseId}/incoming/preview

import { assertEquals } from '@std/assert';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { GET } from '../../../routes/api/v1/pcd/[databaseId]/incoming/preview/+server.ts';
import type { IncomingPreview } from '$pcd/incoming/types.ts';
import { migratedTest } from '../snapshots/rollbackTestHelpers.ts';
import { git, silenceLogger } from './incomingTestHelpers.ts';

function call(databaseId: string) {
  return GET({ params: { databaseId } } as unknown as Parameters<typeof GET>[0]);
}

migratedTest('incoming preview route: 400 for an invalid id, 404 for an unknown database', async () => {
  const restore = silenceLogger();
  try {
    for (const bad of ['x', '0', '-1', '1.5']) {
      const response = await call(bad);
      assertEquals(response.status, 400, `databaseId=${bad}`);
      assertEquals(typeof (await response.json()).error, 'string');
    }
    const missing = await call('987654');
    assertEquals(missing.status, 404);
    assertEquals((await missing.json()).error, 'Database not found');
  } finally {
    restore();
  }
});

migratedTest('incoming preview route: 200 payload for a local-path source (available: false)', async () => {
  const restore = silenceLogger();
  try {
    const databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `route-local-${crypto.randomUUID()}`,
      repositoryUrl: '/tmp/praxrr-route-local-source',
      localPath: '/tmp/praxrr-route-local-clone',
    });
    const response = await call(String(databaseId));
    assertEquals(response.status, 200);
    const payload = (await response.json()) as IncomingPreview;
    assertEquals(payload.databaseId, databaseId);
    assertEquals(payload.available, false);
    assertEquals(payload.unavailableReason, 'local_source');
    assertEquals(payload.conflictStrategy, 'override');
    assertEquals(payload.sections, []);
    assertEquals(payload.predictedConflicts, []);
  } finally {
    restore();
  }
});

migratedTest('incoming preview route: 409 { error, code: sync_in_progress } while a sync runs', async () => {
  const restore = silenceLogger();
  try {
    const databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `route-sync-${crypto.randomUUID()}`,
      repositoryUrl: 'https://example.invalid/praxrr/db',
      localPath: '/tmp/praxrr-route-sync-clone',
    });
    const job = jobQueueQueries.upsertScheduled({
      jobType: 'pcd.sync',
      runAt: new Date().toISOString(),
      payload: { databaseId },
      source: 'manual',
      dedupeKey: `pcd.sync:${databaseId}`,
    });
    jobQueueQueries.setStatus(job.id, 'running');

    const response = await call(String(databaseId));
    assertEquals(response.status, 409);
    const body = await response.json();
    assertEquals(body.code, 'sync_in_progress');
    assertEquals(typeof body.error, 'string');
  } finally {
    restore();
  }
});

migratedTest('incoming preview route: 502 { code: fetch_failed } when origin cannot be fetched', async () => {
  const restore = silenceLogger();
  const root = await Deno.makeTempDir({ prefix: 'incoming-route-' });
  try {
    await git(['init', '--initial-branch=main'], root);
    await git(['config', 'user.name', 'T'], root);
    await git(['config', 'user.email', 't@example.invalid'], root);
    await Deno.writeTextFile(`${root}/pcd.json`, '{}');
    await git(['add', '-A'], root);
    await git(['commit', '-m', 'seed'], root);

    const databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `route-fetch-${crypto.randomUUID()}`,
      repositoryUrl: 'https://example.invalid/praxrr/db',
      localPath: root,
    });
    const response = await call(String(databaseId));
    assertEquals(response.status, 502);
    assertEquals((await response.json()).code, 'fetch_failed');
  } finally {
    restore();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
