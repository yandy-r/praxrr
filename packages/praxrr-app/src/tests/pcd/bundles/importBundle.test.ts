import { assert, assertEquals, assertRejects } from '@std/assert';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import {
  _bundleImportDependencies,
  BundleImportFailedError,
  BundlePlanMismatchError,
  importBundle,
} from '$pcd/bundles/index.ts';
import type {
  EntityType,
  PortableCustomFormat,
  PortableEntityData,
  PortableQualityProfile,
} from '$shared/pcd/portable.ts';
import {
  bundleOf,
  bundleTest,
  createPcd,
  customFormatData,
  liveCache,
  namesIn,
  qualityProfileData,
  regexData,
  scoredFormatNames,
  seedEntity,
  snapshotOps,
} from './bundleTestHelpers.ts';

const SKIP = { default: 'skip', perEntity: {} } as const;

function fullBundle() {
  return bundleOf(
    ['regular_expression', regexData('Rx One')],
    ['custom_format', customFormatData('CF One', 'Rx One')],
    ['custom_format', customFormatData('CF Two', 'Rx One')],
    ['quality_profile', qualityProfileData('QP One', ['CF One', 'CF Two'])]
  );
}

bundleTest('bundle import: QP + CFs + regex into an empty database resolves every scored CF', async () => {
  const databaseId = await createPcd();
  const report = await importBundle({
    databaseId,
    layer: 'user',
    bundle: fullBundle(),
    dryRun: false,
    collisions: SKIP,
  });

  assertEquals(report.applied, true);
  assertEquals(report.errors, []);
  assertEquals(
    report.outcomes.map((outcome) => outcome.action),
    ['create', 'create', 'create', 'create']
  );

  const cache = liveCache(databaseId);
  assertEquals(namesIn(cache, 'regular_expressions'), ['Rx One']);
  assertEquals(namesIn(cache, 'custom_formats'), ['CF One', 'CF Two']);
  assertEquals(scoredFormatNames(cache, 'QP One'), ['CF One', 'CF Two']);
  const orphanScores = cache.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM quality_profile_custom_formats q WHERE NOT EXISTS (SELECT 1 FROM custom_formats c WHERE c.name = q.custom_format_name)'
  );
  assertEquals(orphanScores[0].n, 0);
});

bundleTest('bundle import: dry run reports creates, collisions and missing refs with zero writes', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  const before = snapshotOps(databaseId);
  const cacheBefore = liveCache(databaseId);
  const rowsBefore = namesIn(cacheBefore, 'custom_formats');

  const bundle = bundleOf(
    ['regular_expression', regexData('Rx One')],
    ['custom_format', customFormatData('CF One', 'Rx One')],
    ['quality_profile', qualityProfileData('QP One', ['CF One', 'CF Ghost'])]
  );
  const report = await importBundle({ databaseId, layer: 'user', bundle, dryRun: true, collisions: SKIP });

  assertEquals(report.dryRun, true);
  assertEquals(report.applied, false);
  assertEquals(
    report.outcomes.map((outcome) => `${outcome.entityType}:${outcome.name}:${outcome.action}`),
    ['regular_expression:Rx One:skip', 'custom_format:CF One:create', 'quality_profile:QP One:create']
  );
  assertEquals(report.missingReferences, [
    { fromType: 'quality_profile', fromName: 'QP One', toType: 'custom_format', toName: 'CF Ghost' },
  ]);

  const after = snapshotOps(databaseId);
  assertEquals(after.ops, before.ops);
  assertEquals(after.historyCount, before.historyCount);
  assert(liveCache(databaseId) === cacheBefore, 'live cache must not be swapped by a dry run');
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), rowsBefore);
});

bundleTest('bundle import: unresolved references block a real apply before any write', async () => {
  const databaseId = await createPcd();
  const before = snapshotOps(databaseId);
  const bundle = bundleOf(['quality_profile', qualityProfileData('QP One', ['CF Ghost'])]);
  const report = await importBundle({ databaseId, layer: 'user', bundle, dryRun: false, collisions: SKIP });

  assertEquals(report.applied, false);
  assertEquals(report.missingReferences.length, 1);
  assertEquals(snapshotOps(databaseId), before);
});

bundleTest('bundle import: a mid-bundle failure rolls back every op and history row', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Pre Existing'));
  const before = snapshotOps(databaseId);
  const historyBefore = pcdOpHistoryQueries.listByDatabase(databaseId);

  _bundleImportDependencies.afterLiveEntity = (index) => {
    if (index === 1) throw new Error('injected failure after second entity');
  };
  try {
    const error = await assertRejects(
      () => importBundle({ databaseId, layer: 'user', bundle: fullBundle(), dryRun: false, collisions: SKIP }),
      BundleImportFailedError
    );
    assertEquals(error.report.rolledBack, true);
    assertEquals(error.report.applied, false);
  } finally {
    delete _bundleImportDependencies.afterLiveEntity;
  }

  const after = snapshotOps(databaseId);
  assertEquals(after.ops, before.ops, 'pcd_ops rows differ after rollback');
  assertEquals(
    pcdOpHistoryQueries.listByDatabase(databaseId).length,
    historyBefore.length,
    'pcd_op_history row count differs after rollback'
  );
  assertEquals(namesIn(liveCache(databaseId), 'regular_expressions'), ['Pre Existing']);
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), []);
});

bundleTest('bundle import: a failed overwrite restores the user ops it superseded', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One', 'old-pattern'));
  const before = snapshotOps(databaseId);

  _bundleImportDependencies.afterLiveEntity = () => {
    throw new Error('injected failure after overwrite');
  };
  try {
    await assertRejects(
      () =>
        importBundle({
          databaseId,
          layer: 'user',
          bundle: bundleOf(['regular_expression', regexData('Rx One', 'new-pattern')]),
          dryRun: false,
          collisions: { default: 'overwrite', perEntity: {} },
        }),
      BundleImportFailedError
    );
  } finally {
    delete _bundleImportDependencies.afterLiveEntity;
  }

  assertEquals(snapshotOps(databaseId).ops, before.ops);
  const row = liveCache(databaseId).query<{ pattern: string }>(
    "SELECT pattern FROM regular_expressions WHERE name = 'Rx One'"
  );
  assertEquals(row[0].pattern, 'old-pattern');
});

bundleTest('bundle import: rename policy renames the CF and rewrites the QP score references', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  await seedEntity(databaseId, 'custom_format', customFormatData('CF One', 'Rx One'));

  const bundle = bundleOf(
    ['regular_expression', regexData('Rx One')],
    ['custom_format', customFormatData('CF One', 'Rx One')],
    ['quality_profile', qualityProfileData('QP One', ['CF One'])]
  );
  const report = await importBundle({
    databaseId,
    layer: 'user',
    bundle,
    dryRun: false,
    collisions: { default: 'rename', perEntity: { 'regular_expression:rx one': 'skip' } },
  });

  assertEquals(report.applied, true);
  const byName = new Map(report.outcomes.map((outcome) => [outcome.name, outcome]));
  assertEquals(byName.get('Rx One')?.action, 'skip');
  assertEquals(byName.get('CF One')?.action, 'rename');
  assertEquals(byName.get('CF One')?.finalName, 'CF One (2)');

  const cache = liveCache(databaseId);
  assertEquals(namesIn(cache, 'custom_formats'), ['CF One', 'CF One (2)']);
  assertEquals(scoredFormatNames(cache, 'QP One'), ['CF One (2)']);
});

bundleTest('bundle import: overwrite updates in place with guarded update ops and no delete ops', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One', 'old-pattern'));
  const before = snapshotOps(databaseId);

  const report = await importBundle({
    databaseId,
    layer: 'user',
    bundle: bundleOf(['regular_expression', regexData('Rx One', 'new-pattern')]),
    dryRun: false,
    collisions: { default: 'overwrite', perEntity: {} },
  });

  assertEquals(report.applied, true);
  assertEquals(report.outcomes[0].action, 'overwrite');
  const row = liveCache(databaseId).query<{ pattern: string }>(
    "SELECT pattern FROM regular_expressions WHERE name = 'Rx One'"
  );
  assertEquals(row[0].pattern, 'new-pattern');

  const newOps = snapshotOps(databaseId).ops.filter((op) => !before.ops.some((prior) => prior.id === op.id));
  assert(newOps.length > 0);
  for (const op of newOps) {
    assert(!/\bDELETE\b/i.test(op.sql), `overwrite must not emit DELETE: ${op.sql}`);
    assertEquals(JSON.parse(op.metadata ?? '{}').operation, 'update');
  }
});

bundleTest('bundle import: all writes of one import share a single undo action id', async () => {
  const databaseId = await createPcd();
  const before = snapshotOps(databaseId);
  await importBundle({ databaseId, layer: 'user', bundle: fullBundle(), dryRun: false, collisions: SKIP });

  const newOps = snapshotOps(databaseId).ops.filter((op) => !before.ops.some((prior) => prior.id === op.id));
  const actionIds = new Set(
    newOps.map((op) => JSON.parse(op.metadata ?? '{}').action_id ?? JSON.parse(op.metadata ?? '{}').actionId)
  );
  assert(newOps.length >= 4);
  assertEquals(actionIds.size, 1);
});

bundleTest('bundle import: regex case-mismatch reference resolves to the stored name', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));

  const bundle = bundleOf(
    ['regular_expression', regexData('rx one')],
    ['custom_format', customFormatData('CF One', 'RX ONE')]
  );
  const report = await importBundle({
    databaseId,
    layer: 'user',
    bundle,
    dryRun: false,
    collisions: { default: 'skip', perEntity: {} },
  });

  assertEquals(report.applied, true);
  assertEquals(report.missingReferences, []);
  const cache = liveCache(databaseId);
  assertEquals(namesIn(cache, 'regular_expressions'), ['Rx One']);
  assertEquals(namesIn(cache, 'custom_formats'), ['CF One']);
  // The CF's pattern condition must reference the stored regex name (case-mismatch resolved).
  const conditionPatterns = cache.query<{ regular_expression_name: string }>(
    "SELECT regular_expression_name FROM condition_patterns WHERE custom_format_name = 'CF One'"
  );
  assertEquals(conditionPatterns.length, 1);
  assertEquals(conditionPatterns[0].regular_expression_name, 'Rx One');
});

bundleTest('bundle import: overwrite CF test A with bundle test B leaves only B', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'custom_format', {
    name: 'CF Tests',
    description: null,
    includeInRename: false,
    tags: [],
    conditions: [],
    tests: [{ title: 'Test A', type: 'movie', shouldMatch: true, description: null }],
  });

  const bundle = bundleOf([
    'custom_format',
    {
      name: 'CF Tests',
      description: null,
      includeInRename: false,
      tags: [],
      conditions: [],
      tests: [{ title: 'Test B', type: 'series', shouldMatch: false, description: null }],
    },
  ]);
  const report = await importBundle({
    databaseId,
    layer: 'user',
    bundle,
    dryRun: false,
    collisions: { default: 'overwrite', perEntity: {} },
  });

  assertEquals(report.applied, true);
  const tests = liveCache(databaseId).query<{ title: string }>(
    "SELECT title FROM custom_format_tests WHERE custom_format_name = 'CF Tests'"
  );
  assertEquals(
    tests.map((t) => t.title),
    ['Test B']
  );
});

bundleTest('bundle import: a malformed score shape is a 400, not a TypeError', async () => {
  const databaseId = await createPcd();
  const bundle = bundleOf([
    'quality_profile',
    {
      name: 'QP Bad',
      description: null,
      tags: [],
      language: null,
      orderedItems: [],
      minimumScore: 0,
      upgradeUntilScore: 0,
      upgradeScoreIncrement: 1,
      customFormatScores: [{ customFormatName: 123 as never, arrType: 'radarr', score: 1 }],
    },
  ]);
  try {
    await importBundle({ databaseId, layer: 'user', bundle, dryRun: true, collisions: SKIP });
    assert(false, 'expected BundleInvalidError');
  } catch (error) {
    assert(error instanceof Error);
    assert(error.message.includes('customFormatScores[0].customFormatName must be a non-empty string'));
    assert(!(error instanceof TypeError));
  }
});

bundleTest('bundle import: expectedPlanDigest 409s when the plan no longer matches', async () => {
  const databaseId = await createPcd();
  const bundle = fullBundle();
  const dryRun = await importBundle({ databaseId, layer: 'user', bundle, dryRun: true, collisions: SKIP });
  const digest = dryRun.planDigest;

  await seedEntity(databaseId, 'regular_expression', regexData('Rx Later'));

  const error = await assertRejects(
    () =>
      importBundle({
        databaseId,
        layer: 'user',
        bundle,
        dryRun: false,
        collisions: SKIP,
        expectedPlanDigest: digest,
      }),
    BundlePlanMismatchError
  );
  assert(error.report.planDigest !== digest);
});

bundleTest('bundle import: a QP payload scoring a CF named only in the bundle imports in one pass', async () => {
  const databaseId = await createPcd();
  const qp = qualityProfileData('QP Solo', ['CF Inline']) as PortableQualityProfile;
  const report = await importBundle({
    databaseId,
    layer: 'user',
    bundle: bundleOf(
      ['quality_profile', qp],
      ['regular_expression', regexData('Rx Inline')],
      ['custom_format', customFormatData('CF Inline', 'Rx Inline')]
    ),
    dryRun: false,
    collisions: SKIP,
  });
  // Entries are executed dependency-first regardless of bundle order.
  assertEquals(report.applied, true);
  assertEquals(scoredFormatNames(liveCache(databaseId), 'QP Solo'), ['CF Inline']);
});

bundleTest('bundle import: deferred compile keeps the live cache current during a live apply', async () => {
  const databaseId = await createPcd();
  const bundle = bundleOf(
    ['regular_expression', regexData('Rx Perf')],
    ['custom_format', customFormatData('CF Perf', 'Rx Perf')],
    ['quality_profile', qualityProfileData('QP Perf', ['CF Perf'])]
  );

  const start = performance.now();
  const report = await importBundle({ databaseId, layer: 'user', bundle, dryRun: false, collisions: SKIP });
  const elapsed = performance.now() - start;

  assertEquals(report.applied, true);
  // The QP scores its CF; if the deferred-compile fast path had not applied intermediate SQL,
  // the QP create would have failed or the score would reference a missing CF.
  const cache = liveCache(databaseId);
  assertEquals(namesIn(cache, 'custom_formats'), ['CF Perf']);
  assertEquals(scoredFormatNames(cache, 'QP Perf'), ['CF Perf']);
  assert(elapsed < 30_000, `expected a fast apply, took ${elapsed.toFixed(0)} ms`);
});

bundleTest('bundle import: a large synthetic bundle applies well under the 30s target', async () => {
  const databaseId = await createPcd();
  // 400 entities: 1 regex, 398 CFs, 1 QP scoring all CFs.
  const entries: Array<[EntityType, PortableEntityData]> = [['regular_expression', regexData('Rx Big')]];
  const cfNames: string[] = [];
  for (let i = 0; i < 398; i++) {
    const name = `CF ${String(i).padStart(3, '0')}`;
    cfNames.push(name);
    entries.push(['custom_format', customFormatData(name, 'Rx Big')]);
  }
  const qp = qualityProfileData('QP Big', cfNames) as PortableQualityProfile;
  entries.push(['quality_profile', qp]);

  const start = performance.now();
  const report = await importBundle({
    databaseId,
    layer: 'user',
    bundle: bundleOf(...entries),
    dryRun: false,
    collisions: SKIP,
  });
  const elapsed = performance.now() - start;

  assertEquals(report.applied, true);
  assertEquals(report.outcomes.length, 400);
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats').length, 398);
  assertEquals(scoredFormatNames(liveCache(databaseId), 'QP Big').length, 398);
  console.log(`synthetic 400-entity apply: ${elapsed.toFixed(0)} ms`);
  assert(elapsed < 30_000, `expected well under 30s, took ${elapsed.toFixed(0)} ms`);
});

bundleTest('bundle import: a base-layer QP scoring a user-only CF fails final compile and rolls back', async () => {
  const databaseId = await createPcd({ withToken: true });
  // The CF exists only in the user layer. Base ops replay before user ops, so a base-layer QP
  // scoring it passes per-write validation against the merged live cache but cannot survive the
  // final rebuild.
  await seedEntity(databaseId, 'regular_expression', regexData('Rx User'));
  await seedEntity(databaseId, 'custom_format', customFormatData('CF User Only', 'Rx User'));
  const before = snapshotOps(databaseId);

  const error = await assertRejects(
    () =>
      importBundle({
        databaseId,
        layer: 'base',
        bundle: bundleOf(['quality_profile', qualityProfileData('QP Base', ['CF User Only'])]),
        dryRun: false,
        collisions: SKIP,
      }),
    BundleImportFailedError
  );

  assertEquals(error.report.applied, false);
  assertEquals(error.report.rolledBack, true);
  assertEquals(snapshotOps(databaseId), before);
  assertEquals(namesIn(liveCache(databaseId), 'quality_profiles'), []);
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), ['CF User Only']);
  // A failed compile disables the database instance; the rollback must restore the enabled state.
  assertEquals(databaseInstancesQueries.getById(databaseId)?.enabled, 1);
});

bundleTest(
  'bundle import: a failing multi-write CF in the dry run leaves no partial rows for later entities',
  async () => {
    const databaseId = await createPcd();
    await seedEntity(databaseId, 'regular_expression', regexData('Rx Good'));

    // The second CF conditions step fails: its pattern references a regex that does not exist.
    const bundle = bundleOf(
      ['custom_format', customFormatData('CF Broken', 'Rx Missing')],
      ['custom_format', customFormatData('CF Good', 'Rx Good')],
      ['quality_profile', qualityProfileData('QP Dry', ['CF Good'])]
    );
    // NOTE: CF Broken's missing regex is reported as a missing reference, so it is not executed.
    // Instead make its write fail mid-entity: a pattern referencing an existing regex but with a
    // condition payload that violates the table (empty condition name is rejected by the writer).
    const broken = customFormatData('CF Broken', 'Rx Good') as PortableCustomFormat;
    // Two conditions sharing one name: the create succeeds, the conditions step fails
    // (updateConditions rejects duplicate condition names) — a genuine mid-entity failure.
    broken.conditions.push({ ...broken.conditions[0] });
    bundle.entities[0].data = broken;

    const report = await importBundle({ databaseId, layer: 'user', bundle, dryRun: true, collisions: SKIP });

    assertEquals(report.dryRun, true);
    const byName = new Map(report.outcomes.map((outcome) => [outcome.name, outcome]));
    assertEquals(byName.get('CF Broken')?.action, 'error');
    assertEquals(byName.get('CF Good')?.action, 'create');
    assertEquals(byName.get('QP Dry')?.action, 'create');

    // Nothing was written (dry run) and the live cache never saw the broken CF.
    assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), []);
  }
);
