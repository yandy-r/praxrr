// T5: edge cases of the incoming preview service.

import { assert, assertEquals, assertRejects } from '@std/assert';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import * as customFormats from '$pcd/entities/customFormats/index.ts';
import { previewIncoming } from '$pcd/incoming/preview.ts';
import { IncomingPreviewError } from '$pcd/incoming/types.ts';
import { withUserOpAction } from '$pcd/ops/actionContext.ts';
import { getCache } from '$pcd/database/registry.ts';
import { pcdManager } from '$pcd/index.ts';
import { migratedTest } from '../snapshots/rollbackTestHelpers.ts';
import {
  cfYaml,
  git,
  leakedTempDirs,
  qpYaml,
  setUpGitFixture,
  userSetCfDescription,
  silenceLogger,
  writeEntity,
} from './incomingTestHelpers.ts';

migratedTest('no incoming commits: empty preview, no extraction, fetch still performed', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/a.yaml', cfYaml('A', 'one'));
  });
  try {
    // A second upstream commit exists only on the remote; preview must still see "no updates" for
    // a clone that is current, then see the new commit after the strict fetch.
    const tempBefore = leakedTempDirs();
    const preview = await previewIncoming(fixture.databaseId);
    assertEquals(preview.available, true);
    assertEquals(preview.hasUpdates, false);
    assertEquals(preview.commitsBehind, 0);
    assertEquals(preview.sections, []);
    assertEquals(preview.predictedConflicts, []);
    assertEquals(preview.summary, { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 });
    assertEquals(preview.currentHead, preview.incomingHead);
    assertEquals(leakedTempDirs(), tempBefore);

    // The strict fetch ran: a commit pushed after the clone was made is now reported.
    await writeEntity(fixture.upstreamPath, 'custom-formats/a.yaml', cfYaml('A', 'two'));
    await fixture.pushUpstream('change');
    const after = await previewIncoming(fixture.databaseId);
    assertEquals(after.hasUpdates, true);
    assertEquals(after.commitsBehind, 1);
    assertEquals(after.commits.length, 1);
    assertEquals(after.commits[0].message, 'change');
  } finally {
    await fixture.cleanup();
  }
});

migratedTest('local-path source is reported unavailable and never touches git', async () => {
  const restore = silenceLogger();
  try {
    const databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `local-${crypto.randomUUID()}`,
      repositoryUrl: '/tmp/praxrr-local-source-does-not-exist',
      localPath: '/tmp/praxrr-local-clone-does-not-exist',
    });
    const preview = await previewIncoming(databaseId);
    assertEquals(preview.available, false);
    assertEquals(preview.unavailableReason, 'local_source');
    assertEquals(preview.hasUpdates, false);
    assertEquals(preview.sections, []);
  } finally {
    restore();
  }
});

migratedTest('a delete both sides made is predicted as aligned, not a conflict, and matches the pull', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/doomed.yaml', cfYaml('Doomed', 'bye'));
    await writeEntity(local, 'custom-formats/keep.yaml', cfYaml('Keep', 'stay'));
  });
  const { databaseId } = fixture;
  try {
    const cache = getCache(databaseId)!;
    const row = await cache.kb
      .selectFrom('custom_formats')
      .select('id')
      .where('name', '=', 'Doomed')
      .executeTakeFirstOrThrow();
    const result = await withUserOpAction(() =>
      customFormats.remove({ databaseId, cache, layer: 'user', formatId: row.id, formatName: 'Doomed' })
    );
    assertEquals(result.success, true);

    await Deno.remove(`${fixture.upstreamPath}/entities/custom-formats/doomed.yaml`);
    await fixture.pushUpstream('upstream deletes Doomed');
    const maxHistoryId = Math.max(0, ...pcdOpHistoryQueries.listByDatabase(databaseId).map((h) => h.id));

    const preview = await previewIncoming(databaseId);
    const deleteConflicts = preview.predictedConflicts.filter((c) => c.entityName === 'Doomed');
    assert(deleteConflicts.length > 0, JSON.stringify(preview.predictedConflicts));
    for (const predicted of deleteConflicts) {
      assertEquals(predicted.kind, 'aligned');
      assertEquals(predicted.predictedStatus, 'dropped');
      assertEquals(predicted.conflictReason, 'aligned');
      assertEquals(predicted.operation, 'delete');
    }
    assert(preview.sections.some((s) => s.changes.some((c) => c.name === 'Doomed' && c.action === 'delete')));

    const pulled = await pcdManager.sync(databaseId);
    assertEquals(pulled.success, true, pulled.error);
    for (const predicted of deleteConflicts) {
      const rows = pcdOpHistoryQueries
        .listByOp(predicted.opId)
        .filter((h) => h.id > maxHistoryId)
        .sort((a, b) => a.id - b.id);
      assertEquals(rows[0]?.status, 'dropped');
      assertEquals(rows[0]?.conflict_reason, 'aligned');
      assertEquals(pcdOpsQueries.getById(predicted.opId)?.state, 'dropped');
    }
  } finally {
    await fixture.cleanup();
  }
});

migratedTest('preview_stale: local ops changing mid-preview fail the preview closed', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/a.yaml', cfYaml('A', 'one'));
  });
  const { databaseId } = fixture;
  const original = pcdOpsQueries.listByDatabaseAndOrigin;
  let injected = false;
  try {
    await userSetCfDescription(databaseId, 'A', 'mine');
    await writeEntity(fixture.upstreamPath, 'custom-formats/a.yaml', cfYaml('A', 'two'));
    await fixture.pushUpstream('change');

    // Simulate a concurrent write: the first user-op read during the dry replay publishes another op.
    pcdOpsQueries.listByDatabaseAndOrigin = ((...args: Parameters<typeof original>) => {
      if (!injected && args[1] === 'user') {
        injected = true;
        pcdOpsQueries.create({
          databaseId,
          origin: 'user',
          state: 'published',
          source: 'local',
          sql: 'SELECT 1;',
          metadata: null,
        });
      }
      return original.apply(pcdOpsQueries, args);
    }) as typeof original;

    const tempBefore = leakedTempDirs();
    const error = await assertRejects(() => previewIncoming(databaseId), IncomingPreviewError);
    assertEquals(error.code, 'preview_stale');
    assertEquals(leakedTempDirs(), tempBefore, 'temp dir must be removed on failure');
  } finally {
    pcdOpsQueries.listByDatabaseAndOrigin = original;
    await fixture.cleanup();
  }
});

migratedTest('sync_in_progress: a running pcd.sync job blocks the preview before any git work', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/a.yaml', cfYaml('A', 'one'));
  });
  try {
    const job = jobQueueQueries.upsertScheduled({
      jobType: 'pcd.sync',
      runAt: new Date().toISOString(),
      payload: { databaseId: fixture.databaseId },
      source: 'manual',
      dedupeKey: `pcd.sync:${fixture.databaseId}`,
    });
    jobQueueQueries.setStatus(job.id, 'running');

    const head = await git(['rev-parse', 'refs/remotes/origin/main'], fixture.localPath);
    await writeEntity(fixture.upstreamPath, 'custom-formats/a.yaml', cfYaml('A', 'two'));
    await fixture.pushUpstream('change');

    const error = await assertRejects(() => previewIncoming(fixture.databaseId), IncomingPreviewError);
    assertEquals(error.code, 'sync_in_progress');
    // No fetch happened: the remote-tracking ref did not move.
    assertEquals(await git(['rev-parse', 'refs/remotes/origin/main'], fixture.localPath), head);
  } finally {
    await fixture.cleanup();
  }
});

migratedTest('failing incoming base op fails the preview closed with no writes', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/doomed.yaml', cfYaml('Doomed', 'still referenced'));
    await writeEntity(local, 'quality-profiles/referencing.yaml', qpYaml('Referencing', 'x'));
    await Deno.mkdir(`${local}/tweaks`, { recursive: true });
  });
  const { databaseId } = fixture;
  try {
    // A tweak in the incoming tree whose SQL fails (missing table) must fail the preview closed.
    await Deno.mkdir(`${fixture.upstreamPath}/tweaks`, { recursive: true });
    await Deno.writeTextFile(
      `${fixture.upstreamPath}/tweaks/0.broken.sql`,
      'INSERT INTO missing_tweaks_table (id) VALUES (1);\n'
    );
    await fixture.pushUpstream('broken tweak');

    const opsBefore = pcdOpsQueries.listByDatabase(databaseId);
    const historyBefore = pcdOpHistoryQueries.listByDatabase(databaseId);
    const error = await assertRejects(() => previewIncoming(databaseId), IncomingPreviewError);
    assertEquals(error.code, 'incoming_unavailable');
    assertEquals(pcdOpsQueries.listByDatabase(databaseId), opsBefore);
    assertEquals(pcdOpHistoryQueries.listByDatabase(databaseId), historyBefore);
  } finally {
    await fixture.cleanup();
  }
});

migratedTest('upstream base op that breaks a constraint fails the preview closed (pull would fail)', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/doomed.yaml', cfYaml('Doomed', 'still referenced'));
    await writeEntity(local, 'quality-profiles/referencing.yaml', qpYaml('Referencing', 'x'));
  });
  const { databaseId } = fixture;
  try {
    // Incoming tweaks add a score row referencing a CF the same upstream commit deletes. The
    // replay of the incoming base+tweaks hits the FK and the preview must fail closed naming
    // the failing op file, never return a partial diff — exactly what the pull would fail on.
    await Deno.remove(`${fixture.upstreamPath}/entities/custom-formats/doomed.yaml`);
    await Deno.mkdir(`${fixture.upstreamPath}/tweaks`, { recursive: true });
    await Deno.writeTextFile(
      `${fixture.upstreamPath}/tweaks/0.dangling.sql`,
      "INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES ('Referencing', 'Doomed', 'radarr', 100);\n"
    );
    await fixture.pushUpstream('delete referenced CF');

    const opsBefore = pcdOpsQueries.listByDatabase(databaseId);
    const historyBefore = pcdOpHistoryQueries.listByDatabase(databaseId);
    const error = await assertRejects(() => previewIncoming(databaseId), IncomingPreviewError);
    assertEquals(error.code, 'incoming_unavailable');
    assert(error.message.includes('0.dangling.sql'), `error should name the failing file: ${error.message}`);
    assert(!error.message.includes('INSERT INTO'), 'error must not leak raw SQL');
    assertEquals(pcdOpsQueries.listByDatabase(databaseId), opsBefore);
    assertEquals(pcdOpHistoryQueries.listByDatabase(databaseId), historyBefore);
  } finally {
    await fixture.cleanup();
  }
});

migratedTest('a symlinked dependency checkout in the clone fails the preview closed', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/a.yaml', cfYaml('A', 'one'));
  });
  const { databaseId } = fixture;
  try {
    await writeEntity(fixture.upstreamPath, 'custom-formats/a.yaml', cfYaml('A', 'two'));
    await fixture.pushUpstream('change');

    // Replace the installed schema dependency with a symlink: the temp-tree copy must refuse it.
    // Swap the real checkout for a symlink into a moved copy: copyInstalledDependencies must
    // refuse it before syncDependencies can rewrite the clone.
    const realDeps = await Deno.makeTempDir({ prefix: 'incoming-real-deps-' });
    await Deno.rename(`${fixture.localPath}/deps/praxrr-schema`, `${realDeps}/praxrr-schema`);
    await Deno.symlink(`${realDeps}/praxrr-schema`, `${fixture.localPath}/deps/praxrr-schema`);

    const error = await assertRejects(() => previewIncoming(databaseId), IncomingPreviewError);
    assertEquals(error.code, 'incoming_unavailable');
    assert(error.message.toLowerCase().includes('symlink'), error.message);
  } finally {
    await fixture.cleanup();
  }
});
