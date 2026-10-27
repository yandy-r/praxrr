// YAN-570 acceptance proofs against real git + the real pull:
//   AC1 preview sections == post-pull base-only diff
//   AC2 predicted conflicts == the pull's build-batch conflict history rows (per strategy)
//   AC3 the preview never changes pcd_ops / pcd_op_history / clone HEAD / worktree

import { assert, assertEquals } from '@std/assert';
import { db } from '$db/db.ts';
import { pcdOpHistoryQueries, type PcdOpHistory } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import type { ConflictStrategy } from '$pcd/conflicts/autoAlign/types.ts';
import { PCDCache } from '$pcd/database/cache.ts';
import { previewIncoming } from '$pcd/incoming/preview.ts';
import type { IncomingPreview, PredictedConflict } from '$pcd/incoming/types.ts';
import { pcdManager } from '$pcd/index.ts';
import { withBaseOnlyCache } from '$pcd/resolved/layers.ts';
import { diffAllFamilies } from '$pcd/snapshots/rollback/preview.ts';
import { migratedTest } from '../snapshots/rollbackTestHelpers.ts';
import {
  cfDescription,
  cfYaml,
  git,
  leakedTempDirs,
  qpYaml,
  regexYaml,
  setUpGitFixture,
  userSetCfDescription,
  writeEntity,
  type GitFixture,
} from './incomingTestHelpers.ts';

const BASE_DESC = 'base desc';
const USER_DESC = 'my desc';
const UPSTREAM_DESC = 'upstream desc';
const ALIGN_BASE = 'align base';
const ALIGN_VALUE = 'user aligned';

async function seedScenario(strategy: ConflictStrategy): Promise<GitFixture> {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/test-format.yaml', cfYaml('Test Format', BASE_DESC));
    await writeEntity(local, 'custom-formats/align-format.yaml', cfYaml('Align Format', ALIGN_BASE));
    await writeEntity(local, 'quality-profiles/profile-a.yaml', qpYaml('Profile A', 'profile a'));
    await writeEntity(local, 'regular-expressions/regex-a.yaml', regexYaml('Regex A', 'regex-a'));
  });
  fixture.setStrategy(strategy);
  // Two local edits: one will conflict with upstream, one is already what upstream sets.
  await userSetCfDescription(fixture.databaseId, 'Test Format', USER_DESC);
  await userSetCfDescription(fixture.databaseId, 'Align Format', ALIGN_VALUE);

  const up = fixture.upstreamPath;
  await writeEntity(up, 'custom-formats/test-format.yaml', cfYaml('Test Format', UPSTREAM_DESC));
  await writeEntity(up, 'custom-formats/align-format.yaml', cfYaml('Align Format', ALIGN_VALUE));
  await writeEntity(up, 'quality-profiles/profile-a.yaml', qpYaml('Profile A', 'profile a renamed text'));
  await writeEntity(up, 'quality-profiles/profile-b.yaml', qpYaml('Profile B', 'brand new'));
  await Deno.remove(`${up}/entities/regular-expressions/regex-a.yaml`);
  return fixture;
}

async function gitState(path: string): Promise<{ head: string; status: string; branch: string }> {
  return {
    head: await git(['rev-parse', 'HEAD'], path),
    status: await git(['status', '--porcelain', '-uall'], path),
    branch: await git(['branch', '--show-current'], path),
  };
}

function describeSections(preview: IncomingPreview): string[] {
  return preview.sections.flatMap((section) =>
    section.changes
      .filter((change) => change.action !== 'unchanged')
      .map((change) => `${section.entityType}|${change.name}|${change.action}`)
  );
}

async function runScenario(strategy: ConflictStrategy, check: (ctx: ScenarioResult) => Promise<void>): Promise<void> {
  const fixture = await seedScenario(strategy);
  const { databaseId, localPath } = fixture;
  let preBase: PCDCache | null = null;
  try {
    // Pre-pull base-only state for the post-pull diff (AC1).
    preBase = new PCDCache(localPath, databaseId);
    await preBase.buildReadOnly({ layers: new Set(['schema', 'base', 'tweaks']) });

    const incomingHead = await fixture.pushUpstream('upstream change');

    const opsBefore = pcdOpsQueries.listByDatabase(databaseId);
    const historyBefore = pcdOpHistoryQueries.listByDatabase(databaseId);
    const gitBefore = await gitState(localPath);
    const tempBefore = leakedTempDirs();

    const preview = await previewIncoming(databaseId);

    // AC3: nothing but origin/main moved.
    assertEquals(pcdOpsQueries.listByDatabase(databaseId), opsBefore, 'pcd_ops must be untouched by the preview');
    assertEquals(
      pcdOpHistoryQueries.listByDatabase(databaseId),
      historyBefore,
      'pcd_op_history must be untouched by the preview'
    );
    assertEquals(await gitState(localPath), gitBefore, 'clone HEAD/worktree/branch must be untouched');
    assertEquals(await git(['rev-parse', 'refs/remotes/origin/main'], localPath), incomingHead);
    assertEquals(leakedTempDirs(), tempBefore, 'preview must remove its temp dir');

    // Header
    assertEquals(preview.available, true);
    assertEquals(preview.hasUpdates, true);
    assertEquals(preview.commitsBehind, 1);
    assertEquals(preview.commitsAhead, 0);
    assertEquals(preview.incomingHead, incomingHead);
    assertEquals(preview.currentHead, gitBefore.head);
    assertEquals(preview.conflictStrategy, strategy);
    assertEquals(preview.branch, 'main');
    assertEquals(preview.predictedErrors, []);

    // Real pull.
    const maxHistoryId = Math.max(0, ...historyBefore.map((row) => row.id));
    const result = await pcdManager.sync(databaseId);
    assertEquals(result.success, true, result.error);

    const postDiff = await withBaseOnlyCache(databaseId, (postBase) => diffAllFamilies(preBase!, postBase));
    await check({ fixture, preview, postDiff, maxHistoryId });
  } finally {
    preBase?.close();
    await fixture.cleanup();
  }
}

interface ScenarioResult {
  fixture: GitFixture;
  preview: IncomingPreview;
  postDiff: Awaited<ReturnType<typeof diffAllFamilies>>;
  maxHistoryId: number;
}

/** First history row the pull's build batch wrote for the op. */
function buildBatchRow(databaseId: number, opId: number, maxHistoryId: number): PcdOpHistory | undefined {
  return pcdOpHistoryQueries
    .listByOp(opId)
    .filter((row) => row.database_id === databaseId && row.id > maxHistoryId)
    .sort((a, b) => a.id - b.id)[0];
}

function byEntity(preview: IncomingPreview, name: string): PredictedConflict {
  const found = preview.predictedConflicts.find((conflict) => conflict.entityName === name);
  assert(found, `expected a prediction for ${name}; got ${JSON.stringify(preview.predictedConflicts)}`);
  return found;
}

async function assertAc1And2({ fixture, preview, postDiff, maxHistoryId }: ScenarioResult): Promise<void> {
  // AC1: entity-level changes equal what the pull applied (base-only, pre vs post).
  assertEquals(JSON.parse(JSON.stringify(preview.sections)), JSON.parse(JSON.stringify(postDiff)));
  const actions = describeSections(preview);
  assertEquals(actions, [
    'customFormat|Align Format|update',
    'customFormat|Test Format|update',
    'qualityProfile|Profile A|update',
    'qualityProfile|Profile B|create',
    'regularExpression|Regex A|delete',
  ]);
  const testFormat = preview.sections
    .find((section) => section.entityType === 'customFormat')!
    .changes.find((change) => change.name === 'Test Format')!;
  const descriptionChange = testFormat.fields.find((field) => field.field === 'description');
  assertEquals(descriptionChange?.current, BASE_DESC);
  assertEquals(descriptionChange?.desired, UPSTREAM_DESC);

  // AC2: every prediction equals the pull's build-batch history row for that op.
  assert(preview.predictedConflicts.length >= 2, 'expected predictions for both user ops');
  for (const predicted of preview.predictedConflicts) {
    const row = buildBatchRow(fixture.databaseId, predicted.opId, maxHistoryId);
    assert(row, `op ${predicted.opId} must have a build-batch history row`);
    assertEquals(row.status, predicted.predictedStatus, `status of op ${predicted.opId}`);
    assertEquals(row.conflict_reason, predicted.conflictReason, `reason of op ${predicted.opId}`);
    if (predicted.kind === 'aligned') {
      assertEquals(pcdOpsQueries.getById(predicted.opId)?.state, 'dropped');
    }
  }
  // No user op the preview called clean may have conflicted in the pull.
  const predictedIds = new Set(preview.predictedConflicts.map((conflict) => conflict.opId));
  for (const op of pcdOpsQueries.listByDatabaseAndOrigin(fixture.databaseId, 'user')) {
    if (predictedIds.has(op.id)) continue;
    const row = buildBatchRow(fixture.databaseId, op.id, maxHistoryId);
    if (row) assert(!['conflicted', 'conflicted_pending', 'dropped'].includes(row.status), `unpredicted op ${op.id}`);
  }
}

migratedTest('incoming preview == pull: override strategy (conflict + align)', async () => {
  await runScenario('override', async (ctx) => {
    await assertAc1And2(ctx);
    const conflict = byEntity(ctx.preview, 'Test Format');
    assertEquals(conflict.kind, 'conflict');
    assertEquals(conflict.predictedStatus, 'conflicted');
    assertEquals(conflict.conflictReason, 'guard_mismatch');
    assertEquals(conflict.strategy, 'override');
    assertEquals(conflict.entityType, 'custom_format');
    assertEquals(conflict.operation, 'update');
    const aligned = byEntity(ctx.preview, 'Align Format');
    assertEquals(aligned.kind, 'aligned');
    assertEquals(aligned.predictedStatus, 'dropped');
    assertEquals(aligned.conflictReason, 'aligned');
    // Under `override` the pull may resolve the recorded conflict afterwards (superseded /
    // replacement-op rows); AC2 compares build-batch rows only, which assertAc1And2 does.
    assertEquals(await cfDescription(ctx.fixture.databaseId, 'Align Format'), ALIGN_VALUE);
  });
});

migratedTest('incoming preview == pull: ask strategy parks the conflict', async () => {
  await runScenario('ask', async (ctx) => {
    await assertAc1And2(ctx);
    const conflict = byEntity(ctx.preview, 'Test Format');
    assertEquals(conflict.predictedStatus, 'conflicted_pending');
    assertEquals(conflict.conflictReason, 'guard_mismatch');
    assertEquals(conflict.strategy, 'ask');
    assertEquals(await cfDescription(ctx.fixture.databaseId, 'Test Format'), UPSTREAM_DESC);
    const row = db.queryFirst<{ state: string }>('SELECT state FROM pcd_ops WHERE id = ?', conflict.opId);
    assertEquals(row?.state, 'published');
  });
});

migratedTest('incoming preview == pull: align strategy force-aligns the conflict', async () => {
  await runScenario('align', async (ctx) => {
    await assertAc1And2(ctx);
    const conflict = byEntity(ctx.preview, 'Test Format');
    assertEquals(conflict.kind, 'aligned');
    assertEquals(conflict.predictedStatus, 'dropped');
    assertEquals(conflict.conflictReason, 'aligned');
    assertEquals(conflict.strategy, 'align');
    assertEquals(await cfDescription(ctx.fixture.databaseId, 'Test Format'), UPSTREAM_DESC);
  });
});

for (const strategy of ['override', 'ask', 'align'] as const) {
  migratedTest(`incoming preview == pull: SQL-error conflict (duplicate name) under ${strategy}`, async () => {
    const fixture = await setUpGitFixture(async (local) => {
      await writeEntity(local, 'custom-formats/base.yaml', cfYaml('Base', 'x'));
    });
    fixture.setStrategy(strategy);
    try {
      // The user op must land AFTER the incoming base row: only then does its INSERT hit the
      // UNIQUE constraint (duplicate_key) on replay. A direct insert with an explicit high
      // sequence is the only way to control that ordering — the import skip rule otherwise
      // drops an upstream create for an entity the user already owns.
      await writeEntity(fixture.upstreamPath, 'custom-formats/new-format.yaml', cfYaml('New Format', 'from upstream'));
      await fixture.pushUpstream('upstream adds New Format');
      const createOpId = pcdOpsQueries.create({
        databaseId: fixture.databaseId,
        origin: 'user',
        state: 'published',
        source: 'local',
        sql: `insert into "custom_formats" ("name", "description") values ('New Format', '');`,
        metadata: JSON.stringify({ operation: 'create', entity: 'custom_format', name: 'New Format' }),
        desiredState: JSON.stringify({ name: { from: null, to: 'New Format' } }),
        sequence: 4_999_999_000,
      });
      const historyBefore = pcdOpHistoryQueries.listByDatabase(fixture.databaseId);
      const maxHistoryId = Math.max(0, ...historyBefore.map((row) => row.id));

      const preview = await previewIncoming(fixture.databaseId);
      const predicted = preview.predictedConflicts.find((conflict) => conflict.opId === createOpId);
      assert(predicted, JSON.stringify(preview.predictedConflicts));
      assertEquals(predicted.kind, 'conflict');
      assertEquals(predicted.conflictReason, 'duplicate_key');
      assertEquals(predicted.operation, 'create');
      assertEquals(predicted.strategy, strategy);
      // duplicate_key is a SQL-error conflict: it stays conflicted under every strategy (no
      // force-align), and only override would auto-override it after the build.
      assertEquals(predicted.predictedStatus, strategy === 'ask' ? 'conflicted_pending' : 'conflicted');

      const pulled = await pcdManager.sync(fixture.databaseId);
      assertEquals(pulled.success, true, pulled.error);
      const row = buildBatchRow(fixture.databaseId, predicted.opId, maxHistoryId);
      assert(row, 'the pull must have recorded the conflict');
      assertEquals(row.status, predicted.predictedStatus);
      assertEquals(row.conflict_reason, 'duplicate_key');
    } finally {
      await fixture.cleanup();
    }
  });
}

migratedTest('incoming preview == pull: delete a multi-op CF sharing a refreshed regex', async () => {
  const sourceRoot = new URL('../../../../../praxrr-db/entities/', import.meta.url);
  const deletedPath = 'custom-formats/720p-golden-popcorn.yaml';
  const retainedPath = 'custom-formats/1080p-golden-popcorn.yaml';
  const regexPath = 'regular-expressions/golden-popcorn-negation.yaml';
  const fixture = await setUpGitFixture(async (local) => {
    for (const path of [regexPath, retainedPath, deletedPath]) {
      await writeEntity(local, path, await Deno.readTextFile(new URL(path, sourceRoot)));
    }
  });
  const { databaseId, localPath, upstreamPath } = fixture;
  const preBase = new PCDCache(localPath, databaseId);
  try {
    fixture.setStrategy('ask');
    await userSetCfDescription(databaseId, '1080p Golden Popcorn', 'local description');
    await preBase.buildReadOnly({ layers: new Set(['schema', 'base', 'tweaks']) });
    const removedOps = pcdOpsQueries
      .listByDatabaseAndOrigin(databaseId, 'base')
      .filter((op) => op.filename?.startsWith(`entities/${deletedPath}#`));
    assert(removedOps.length >= 5, 'fixture must cover a multi-operation custom format');
    assert(removedOps.some((op) => op.sql.includes('Golden Popcorn Negation')));

    await Deno.remove(`${upstreamPath}/entities/${deletedPath}`);
    const retainedYaml = await Deno.readTextFile(`${upstreamPath}/entities/${retainedPath}`);
    await writeEntity(
      upstreamPath,
      retainedPath,
      retainedYaml.replace(/^description:.*$/m, 'description: upstream description')
    );
    await fixture.pushUpstream('delete unreferenced multi-op CF and update its sibling');

    const opsBefore = pcdOpsQueries.listByDatabase(databaseId);
    const historyBefore = pcdOpHistoryQueries.listByDatabase(databaseId);
    const cloneBefore = await gitState(localPath);
    const preview = await previewIncoming(databaseId);
    assertEquals(preview.available, true);
    assertEquals(preview.predictedErrors, []);
    assertEquals(pcdOpsQueries.listByDatabase(databaseId), opsBefore);
    assertEquals(pcdOpHistoryQueries.listByDatabase(databaseId), historyBefore);
    assertEquals(await gitState(localPath), cloneBefore);
    assertEquals(describeSections(preview), [
      'customFormat|1080p Golden Popcorn|update',
      'customFormat|720p Golden Popcorn|delete',
    ]);

    const pulled = await pcdManager.sync(databaseId);
    assertEquals(pulled.success, true, pulled.error);
    const postDiff = await withBaseOnlyCache(databaseId, (postBase) => diffAllFamilies(preBase, postBase));
    assertEquals(preview.sections, postDiff);
    for (const removed of removedOps) {
      assertEquals(pcdOpsQueries.getById(removed.id)?.state, 'orphaned');
      assertEquals(
        pcdOpHistoryQueries.listByOp(removed.id),
        historyBefore.filter((row) => row.op_id === removed.id)
      );
    }
  } finally {
    preBase.close();
    await fixture.cleanup();
  }
});
