import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { compile } from '$pcd/index.ts';
import {
  isOverrideRevertError,
  listOverrides,
  OverrideRevertError,
  revertEntityOverrides,
  undoLastAction,
} from '$pcd/overrides/index.ts';
import { resolveLayerState } from '$pcd/resolved/layerDiff.ts';
import { ResolvedConfigDatabaseNotFoundError, withBaseOnlyCache } from '$pcd/resolved/layers.ts';
import { currentUserOpActionId, withUserOpAction } from '$pcd/ops/actionContext.ts';
import { parseUserOpMetadata } from '$pcd/overrides/identity.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { readResolvedEntity } from '$pcd/resolved/readers.ts';
import type { ResolvedEntityType } from '$pcd/resolved/types.ts';
import * as customFormats from '$pcd/entities/customFormats/index.ts';
import * as qualityProfiles from '$pcd/entities/qualityProfiles/index.ts';
import * as regularExpressions from '$pcd/entities/regularExpressions/index.ts';
import { createTest } from '$pcd/entities/customFormats/tests/create.ts';
import { overrideConflict } from '$pcd/conflicts/override.ts';
import {
  BASE_CUSTOM_FORMAT_NAME,
  BASE_DELAY_PROFILE_NAME,
  BASE_QUALITY_PROFILE_NAME,
  BASE_REGEX_NAME,
  BASE_REGEX_PATTERN,
  DEFAULT_BASE_OPS,
  DOOMED_REGEX_NAME,
  overridesTest,
  type PcdFixture,
} from './overridesTestHelpers.ts';

const CREATED_CF_NAME = 'User Created CF';
const SCORING_BASE_OP = `INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES ('${BASE_QUALITY_PROFILE_NAME}', '${BASE_CUSTOM_FORMAT_NAME}', 'radarr', 100);`;

async function updateRegex(
  fixture: PcdFixture,
  name: string,
  changes: { name?: string; pattern?: string; description?: string | null }
): Promise<void> {
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = (await regularExpressions.list(cache)).find((row) => row.name === name);
    assertExists(current);
    return regularExpressions.update({
      databaseId,
      cache,
      layer: 'user',
      current,
      input: {
        name: changes.name ?? current.name,
        pattern: changes.pattern ?? current.pattern,
        tags: [],
        description: changes.description === undefined ? current.description : changes.description,
        regex101Id: current.regex101_id,
      },
    });
  });
}

async function deleteRegex(fixture: PcdFixture, name: string): Promise<void> {
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = (await regularExpressions.list(cache)).find((row) => row.name === name);
    assertExists(current);
    return regularExpressions.remove({ databaseId, cache, layer: 'user', current });
  });
}

async function createCustomFormat(fixture: PcdFixture): Promise<void> {
  await fixture.writeUserEdit((cache, databaseId) =>
    customFormats.create({
      databaseId,
      cache,
      layer: 'user',
      input: { name: CREATED_CF_NAME, description: 'made locally', includeInRename: false, tags: [] },
    })
  );
}

async function deleteBaseCustomFormat(fixture: PcdFixture): Promise<void> {
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = (await customFormats.list(cache)).find((row) => row.name === BASE_CUSTOM_FORMAT_NAME);
    assertExists(current);
    return customFormats.remove({
      databaseId,
      cache,
      layer: 'user',
      formatId: current.id,
      formatName: current.name,
    });
  });
}

async function entityOpIds(fixture: PcdFixture, entityType: ResolvedEntityType, name: string): Promise<number[]> {
  const snapshot = await listOverrides(fixture.databaseId);
  const entity = snapshot.entities.find((row) => row.entityType === entityType && row.name === name);
  assertExists(entity, `${entityType} "${name}" should carry overrides`);
  return entity.ops.map((op) => op.id);
}

/** Narrowed read of the `pattern` field from a resolved regular-expression payload. */
function patternOf(entity: unknown): unknown {
  if (entity && typeof entity === 'object' && 'pattern' in entity) return entity.pattern;
  return undefined;
}

function publishedUserOpIds(fixture: PcdFixture): number[] {
  return pcdOpsQueries
    .listByDatabaseAndOrigin(fixture.databaseId, 'user', { states: ['published'] })
    .map((op) => op.id);
}

async function assertRevertError(
  promise: Promise<unknown>,
  status: 404 | 409,
  reason: string
): Promise<OverrideRevertError> {
  const error = await assertRejects(() => promise, OverrideRevertError);
  assert(isOverrideRevertError(error));
  assertEquals(error.status, status);
  assertEquals(error.reason, reason);
  return error;
}

overridesTest("revert: dropping all of an entity's ops makes resolved equal base (AC2)", async (fixture) => {
  await updateRegex(fixture, BASE_REGEX_NAME, { pattern: 'edited-pattern' });
  await updateRegex(fixture, BASE_REGEX_NAME, { description: 'edited description' });
  await updateRegex(fixture, DOOMED_REGEX_NAME, { pattern: 'other-edit' });

  const opIds = await entityOpIds(fixture, 'regularExpression', BASE_REGEX_NAME);
  assertEquals(opIds.length, 2);

  const result = await revertEntityOverrides({
    databaseId: fixture.databaseId,
    entityType: 'regularExpression',
    name: BASE_REGEX_NAME,
  });
  assertEquals(result.revertedOpIds, opIds);
  assertEquals(result.remainingOpIds, []);
  assertEquals(result.cascadedEntities, []);
  assertEquals(result.resolvedMatchesBase, true);

  // The reverted ops are soft-dropped with one shared audit batch.
  const history = opIds.map((id) => pcdOpHistoryQueries.listByOp(id)[0]);
  assert(history.every((row) => row.status === 'dropped'));
  assertEquals(new Set(history.map((row) => row.batch_id)).size, 1);
  assert(opIds.every((id) => pcdOpsQueries.getById(id)?.state === 'dropped'));

  // No override remains for the entity; the untouched-by-revert one keeps its own.
  const snapshot = await listOverrides(fixture.databaseId);
  assertEquals(
    snapshot.entities.map((entity) => entity.name),
    [DOOMED_REGEX_NAME]
  );

  const state = await resolveLayerState({
    databaseId: fixture.databaseId,
    entityType: 'regularExpression',
    arrType: undefined,
    name: BASE_REGEX_NAME,
    layer: 'user',
  });
  assertEquals(state.layer, 'user');
  if (state.layer === 'user') {
    assertEquals(state.overrides, []);
    assertEquals(state.present, true);
  }

  const resolved = await readResolvedEntity(fixture.cache(), 'regularExpression', undefined, BASE_REGEX_NAME);
  const base = await withBaseOnlyCache(fixture.databaseId, (baseCache) =>
    readResolvedEntity(baseCache, 'regularExpression', undefined, BASE_REGEX_NAME)
  );
  assertEquals(resolved, base);
  assertEquals(patternOf(resolved), BASE_REGEX_PATTERN);
});

overridesTest('revert: selected opIds revert only those ops', async (fixture) => {
  await updateRegex(fixture, BASE_REGEX_NAME, { pattern: 'edited-pattern' });
  await updateRegex(fixture, BASE_REGEX_NAME, { description: 'edited description' });
  const [patternOp, descriptionOp] = await entityOpIds(fixture, 'regularExpression', BASE_REGEX_NAME);

  const result = await revertEntityOverrides({
    databaseId: fixture.databaseId,
    entityType: 'regularExpression',
    name: BASE_REGEX_NAME,
    opIds: [patternOp],
  });
  assertEquals(result.revertedOpIds, [patternOp]);
  assertEquals(result.remainingOpIds, [descriptionOp]);
  assertEquals(result.resolvedMatchesBase, null);
  assertEquals(publishedUserOpIds(fixture), [descriptionOp]);

  const snapshot = await listOverrides(fixture.databaseId);
  const [entity] = snapshot.entities;
  assertEquals(
    entity.overrides.map((change) => change.field),
    ['description']
  );
  const resolved = await readResolvedEntity(fixture.cache(), 'regularExpression', undefined, BASE_REGEX_NAME);
  assertEquals(patternOf(resolved), BASE_REGEX_PATTERN);

  // The already-dropped op cannot be reverted again; a foreign or unknown op is not found.
  const dropped = await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'regularExpression',
      name: BASE_REGEX_NAME,
      opIds: [patternOp],
    }),
    409,
    'op_not_revertible'
  );
  assertEquals(dropped.blockingOpIds, [patternOp]);
});

overridesTest('revert: foreign and unknown op ids are 404 op_not_found, unknown entity is 404', async (fixture) => {
  await updateRegex(fixture, BASE_REGEX_NAME, { pattern: 'edited-pattern' });
  await updateRegex(fixture, DOOMED_REGEX_NAME, { pattern: 'other-edit' });
  const [foreignOp] = await entityOpIds(fixture, 'regularExpression', DOOMED_REGEX_NAME);
  const before = pcdOpsQueries.listByDatabase(fixture.databaseId);

  await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'regularExpression',
      name: BASE_REGEX_NAME,
      opIds: [foreignOp],
    }),
    404,
    'op_not_found'
  );
  await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'regularExpression',
      name: BASE_REGEX_NAME,
      opIds: [987654],
    }),
    404,
    'op_not_found'
  );
  await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'regularExpression',
      name: 'No Such Regex',
    }),
    404,
    'entity_not_found'
  );
  // An entity without overrides is not found either (name exists upstream, but nothing to revert).
  await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'delayProfile',
      name: BASE_DELAY_PROFILE_NAME,
    }),
    404,
    'entity_not_found'
  );
  assertEquals(pcdOpsQueries.listByDatabase(fixture.databaseId), before);
});

overridesTest('revert: partial selection blocked by overlapping or rename ops', async (fixture) => {
  // Overlapping: two edits of the same field form a guard chain.
  await updateRegex(fixture, BASE_REGEX_NAME, { pattern: 'first-edit' });
  await updateRegex(fixture, BASE_REGEX_NAME, { pattern: 'second-edit' });
  const [first, second] = await entityOpIds(fixture, 'regularExpression', BASE_REGEX_NAME);
  const before = pcdOpsQueries.listByDatabase(fixture.databaseId);

  const overlap = await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'regularExpression',
      name: BASE_REGEX_NAME,
      opIds: [first],
    }),
    409,
    'selection_blocked'
  );
  assertEquals(overlap.blockingOpIds, [second]);

  // Rename followed by another edit: the rename op cannot be taken out alone.
  await updateRegex(fixture, DOOMED_REGEX_NAME, { name: 'Renamed Doomed' });
  await updateRegex(fixture, 'Renamed Doomed', { description: 'after rename' });
  const [renameOp, laterOp] = await entityOpIds(fixture, 'regularExpression', 'Renamed Doomed');
  const renameBlock = await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'regularExpression',
      name: 'Renamed Doomed',
      opIds: [renameOp],
    }),
    409,
    'selection_blocked'
  );
  assertEquals(renameBlock.blockingOpIds, [laterOp]);

  assertEquals(pcdOpsQueries.listByDatabase(fixture.databaseId).length, before.length + 2);
  assertEquals(publishedUserOpIds(fixture).includes(renameOp), true);
  assertEquals(publishedUserOpIds(fixture).includes(laterOp), true);

  // Reverting the rename WITH its follower reverts the whole entity back under its base name.
  const result = await revertEntityOverrides({
    databaseId: fixture.databaseId,
    entityType: 'regularExpression',
    name: 'Renamed Doomed',
    opIds: [renameOp, laterOp],
  });
  assertEquals(result.revertedOpIds, [renameOp, laterOp]);
  assertEquals(result.resolvedMatchesBase, true);
  assertExists((await regularExpressions.list(fixture.cache())).find((row) => row.name === DOOMED_REGEX_NAME));
});

overridesTest('revert: a user-created entity reverts to non-existent', async (fixture) => {
  await createCustomFormat(fixture);
  const opIds = await entityOpIds(fixture, 'customFormat', CREATED_CF_NAME);

  const result = await revertEntityOverrides({
    databaseId: fixture.databaseId,
    entityType: 'customFormat',
    name: CREATED_CF_NAME,
  });
  assertEquals(result.revertedOpIds, opIds);
  // Absent from both layers: not comparable.
  assertEquals(result.resolvedMatchesBase, null);
  assertEquals(
    (await customFormats.list(fixture.cache())).map((row) => row.name),
    [BASE_CUSTOM_FORMAT_NAME]
  );
  assertEquals((await listOverrides(fixture.databaseId)).entities, []);
});

overridesTest('revert: a user delete reverts back to the base entity', async (fixture) => {
  await deleteRegex(fixture, DOOMED_REGEX_NAME);
  assertEquals(
    (await regularExpressions.list(fixture.cache())).some((row) => row.name === DOOMED_REGEX_NAME),
    false
  );

  const result = await revertEntityOverrides({
    databaseId: fixture.databaseId,
    entityType: 'regularExpression',
    name: DOOMED_REGEX_NAME,
  });
  assertEquals(result.resolvedMatchesBase, true);
  assertEquals(
    (await regularExpressions.list(fixture.cache())).some((row) => row.name === DOOMED_REGEX_NAME),
    true
  );
  assertEquals((await listOverrides(fixture.databaseId)).entities, []);
});

overridesTest(
  'revert: co-grouped ops of another entity are group_dependency unless cascadeGroup',
  async (fixture) => {
    await deleteBaseCustomFormat(fixture);
    const ops = pcdOpsQueries.listByDatabaseAndOrigin(fixture.databaseId, 'user', { states: ['published'] });
    assert(ops.length >= 2, 'CF delete also writes a generated scoring removal');
    const before = pcdOpsQueries.listByDatabase(fixture.databaseId);

    const blocked = await assertRevertError(
      revertEntityOverrides({
        databaseId: fixture.databaseId,
        entityType: 'customFormat',
        name: BASE_CUSTOM_FORMAT_NAME,
      }),
      409,
      'group_dependency'
    );
    assertEquals(blocked.entities, [{ entityType: 'qualityProfile', arrType: null, name: BASE_QUALITY_PROFILE_NAME }]);
    assertEquals(pcdOpsQueries.listByDatabase(fixture.databaseId), before);

    const result = await revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'customFormat',
      name: BASE_CUSTOM_FORMAT_NAME,
      cascadeGroup: true,
    });
    assertEquals(result.cascadedEntities, [
      { entityType: 'qualityProfile', arrType: null, name: BASE_QUALITY_PROFILE_NAME },
    ]);
    assertEquals(
      result.revertedOpIds,
      ops.map((op) => op.id)
    );
    assertEquals(publishedUserOpIds(fixture), []);
    assertEquals(result.resolvedMatchesBase, true);

    const scores = await fixture.cache().kb.selectFrom('quality_profile_custom_formats').selectAll().execute();
    assertEquals(scores.length, 1);
    assertEquals(scores[0].score, 100);
  },
  { baseOps: [...DEFAULT_BASE_OPS, SCORING_BASE_OP] }
);

overridesTest('revert: remaining ops depending on a created entity block the revert', async (fixture) => {
  await createCustomFormat(fixture);
  const dependentId = fixture.insertUserOp({
    metadata: {
      operation: 'update',
      entity: 'quality_profile',
      name: BASE_QUALITY_PROFILE_NAME,
      stable_key: { key: 'quality_profile_name', value: BASE_QUALITY_PROFILE_NAME },
      changed_fields: ['custom_format_scores'],
      depends_on: [{ entity: 'custom_format', key: 'custom_format_name', value: CREATED_CF_NAME }],
    },
  });
  const before = pcdOpsQueries.listByDatabase(fixture.databaseId);

  const error = await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'customFormat',
      name: CREATED_CF_NAME,
    }),
    409,
    'dependent_ops'
  );
  assertEquals(error.blockingOpIds, [dependentId]);
  assertEquals(pcdOpsQueries.listByDatabase(fixture.databaseId), before);
});

overridesTest('revert: CF test creation does not remove the format used by profile score ops', async (fixture) => {
  await fixture.writeUserEdit((_, databaseId) =>
    createTest({
      databaseId,
      layer: 'user',
      formatName: BASE_CUSTOM_FORMAT_NAME,
      input: { title: 'Local movie test', type: 'movie', should_match: true, description: null },
    })
  );
  const testOps = await entityOpIds(fixture, 'customFormat', BASE_CUSTOM_FORMAT_NAME);
  const scoreId = fixture.insertUserOp({
    metadata: {
      operation: 'update',
      entity: 'quality_profile',
      name: BASE_QUALITY_PROFILE_NAME,
      stable_key: { key: 'quality_profile_name', value: BASE_QUALITY_PROFILE_NAME },
      changed_fields: ['custom_format_scores'],
      depends_on: [{ entity: 'custom_format', key: 'custom_format_name', value: BASE_CUSTOM_FORMAT_NAME }],
    },
    sql: `INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES ('${BASE_QUALITY_PROFILE_NAME}', '${BASE_CUSTOM_FORMAT_NAME}', 'radarr', 200);`,
  });
  await compile(fixture.pcdPath, fixture.databaseId);

  const result = await revertEntityOverrides({
    databaseId: fixture.databaseId,
    entityType: 'customFormat',
    name: BASE_CUSTOM_FORMAT_NAME,
  });
  assertEquals(result.revertedOpIds, testOps);
  assertEquals(result.resolvedMatchesBase, true);
  assertEquals(publishedUserOpIds(fixture), [scoreId]);
  assertEquals(
    (await fixture.cache().kb.selectFrom('quality_profile_custom_formats').selectAll().execute())[0].score,
    200
  );
});

overridesTest('revert: selecting a CF test does not block a later format field edit', async (fixture) => {
  await fixture.writeUserEdit((_, databaseId) =>
    createTest({
      databaseId,
      layer: 'user',
      formatName: BASE_CUSTOM_FORMAT_NAME,
      input: { title: 'Local test', type: 'movie', should_match: true, description: null },
    })
  );
  const testOps = await entityOpIds(fixture, 'customFormat', BASE_CUSTOM_FORMAT_NAME);
  const editId = fixture.insertUserOp({
    metadata: {
      operation: 'update',
      entity: 'custom_format',
      name: BASE_CUSTOM_FORMAT_NAME,
      stable_key: { key: 'custom_format_name', value: BASE_CUSTOM_FORMAT_NAME },
      changed_fields: ['description'],
    },
    sql: `UPDATE custom_formats SET description = 'edited' WHERE name = '${BASE_CUSTOM_FORMAT_NAME}';`,
  });
  await compile(fixture.pcdPath, fixture.databaseId);
  const result = await revertEntityOverrides({
    databaseId: fixture.databaseId,
    entityType: 'customFormat',
    name: BASE_CUSTOM_FORMAT_NAME,
    opIds: testOps,
  });
  assertEquals(result.remainingOpIds, [editId]);
});

overridesTest('revert: post-recompile conflict rolls pcd_ops back unchanged (fail-closed)', async (fixture) => {
  const regexMetadata = (changedFields: string[]) => ({
    operation: 'update',
    entity: 'regular_expression',
    name: BASE_REGEX_NAME,
    stable_key: { key: 'regular_expression_name', value: BASE_REGEX_NAME },
    changed_fields: changedFields,
  });
  // Y's guard only matches while X's result is in place, so dropping X makes Y conflict.
  const x = fixture.insertUserOp({
    metadata: regexMetadata(['pattern']),
    sql: `UPDATE regular_expressions SET pattern = 'x1' WHERE name = '${BASE_REGEX_NAME}' AND pattern = '${BASE_REGEX_PATTERN}';`,
  });
  const y = fixture.insertUserOp({
    metadata: regexMetadata(['description']),
    sql: `UPDATE regular_expressions SET description = 'y1' WHERE name = '${BASE_REGEX_NAME}' AND pattern = 'x1';`,
  });
  await compile(fixture.pcdPath, fixture.databaseId);
  assertEquals(pcdOpHistoryQueries.listByOp(y)[0].status, 'applied');
  const before = pcdOpsQueries.listByDatabase(fixture.databaseId);

  const error = await assertRevertError(
    revertEntityOverrides({
      databaseId: fixture.databaseId,
      entityType: 'regularExpression',
      name: BASE_REGEX_NAME,
      opIds: [x],
    }),
    409,
    'conflict_after_revert'
  );
  assertEquals(error.blockingOpIds, [y]);

  assertEquals(pcdOpsQueries.listByDatabase(fixture.databaseId), before);
  assertEquals(publishedUserOpIds(fixture), [x, y]);
  // The cache was rebuilt from the restored rows: X is in effect again.
  const resolved = await readResolvedEntity(fixture.cache(), 'regularExpression', undefined, BASE_REGEX_NAME);
  assertEquals(patternOf(resolved), 'x1');
  assertEquals(pcdOpHistoryQueries.listByOp(y)[0].status, 'applied');
});

overridesTest('undo: reverts exactly the most recent action group and nothing older (AC3)', async (fixture) => {
  // Action A: a regex edit.
  await updateRegex(fixture, BASE_REGEX_NAME, { pattern: 'edited-pattern' });
  const regexOps = await entityOpIds(fixture, 'regularExpression', BASE_REGEX_NAME);

  // Action B: one quality profile save that writes several ops (description + tags).
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const row = await cache.kb
      .selectFrom('quality_profiles')
      .select('id')
      .where('name', '=', BASE_QUALITY_PROFILE_NAME)
      .executeTakeFirstOrThrow();
    const current = await qualityProfiles.general(cache, row.id);
    assertExists(current);
    return qualityProfiles.updateGeneral({
      databaseId,
      cache,
      layer: 'user',
      current,
      input: { name: current.name, description: 'new description', tags: ['local-tag'], language: null },
    });
  });
  const profileOps = await entityOpIds(fixture, 'qualityProfile', BASE_QUALITY_PROFILE_NAME);
  assertEquals(profileOps.length, 2);

  const snapshot = await listOverrides(fixture.databaseId);
  assertExists(snapshot.lastAction);

  // A stale expectation fails closed without touching anything.
  const before = pcdOpsQueries.listByDatabase(fixture.databaseId);
  await assertRevertError(
    undoLastAction({ databaseId: fixture.databaseId, expectedActionId: 'not-the-last-action' }),
    409,
    'stale_action'
  );
  assertEquals(pcdOpsQueries.listByDatabase(fixture.databaseId), before);

  const undone = await undoLastAction({
    databaseId: fixture.databaseId,
    expectedActionId: snapshot.lastAction.actionId,
  });
  assertEquals(undone.undoneActionId, snapshot.lastAction.actionId);
  assertEquals(undone.revertedOpIds, profileOps);
  assertEquals(undone.reactivatedOpIds, []);
  assertEquals(undone.entities, [{ entityType: 'qualityProfile', arrType: null, name: BASE_QUALITY_PROFILE_NAME }]);

  // Only B is gone; A is untouched and still in effect.
  assertEquals(publishedUserOpIds(fixture), regexOps);
  const after = await listOverrides(fixture.databaseId);
  assertEquals(
    after.entities.map((entity) => entity.name),
    [BASE_REGEX_NAME]
  );
  const profile = await qualityProfiles.general(
    fixture.cache(),
    (
      await fixture
        .cache()
        .kb.selectFrom('quality_profiles')
        .select('id')
        .where('name', '=', BASE_QUALITY_PROFILE_NAME)
        .executeTakeFirstOrThrow()
    ).id
  );
  assertEquals(profile?.description, 'qp description');
  assertEquals(profile?.tags, []);

  // The next undo takes A; afterwards there is nothing left.
  const second = await undoLastAction({ databaseId: fixture.databaseId });
  assertEquals(second.revertedOpIds, regexOps);
  assertEquals(publishedUserOpIds(fixture), []);
  await assertRevertError(undoLastAction({ databaseId: fixture.databaseId }), 404, 'nothing_to_undo');
});

overridesTest('undo: nothing to undo is 404', async (fixture) => {
  await assertRevertError(undoLastAction({ databaseId: fixture.databaseId }), 404, 'nothing_to_undo');
});

overridesTest('undo: undoing a user delete reactivates the earlier edit it superseded', async (fixture) => {
  await updateRegex(fixture, BASE_REGEX_NAME, { description: 'edited description' });
  const [editOp] = await entityOpIds(fixture, 'regularExpression', BASE_REGEX_NAME);
  await deleteRegex(fixture, BASE_REGEX_NAME);
  assertEquals(pcdOpsQueries.getById(editOp)?.state, 'superseded');
  const [deleteOp] = publishedUserOpIds(fixture);
  assert(deleteOp > editOp);

  const result = await undoLastAction({ databaseId: fixture.databaseId });
  assertEquals(result.revertedOpIds, [deleteOp]);
  assertEquals(result.reactivatedOpIds, [editOp]);
  assertEquals(pcdOpsQueries.getById(deleteOp)?.state, 'dropped');
  assertEquals(pcdOpsQueries.getById(editOp)?.state, 'published');
  assertEquals(pcdOpsQueries.getById(editOp)?.superseded_by_op_id, null);
  assertEquals(publishedUserOpIds(fixture), [editOp]);

  // The reactivated edit is back in effect on the entity the delete had removed (the delete's
  // guard only covers name + pattern, so superseding the description edit leaves it applicable).
  const restored = (await regularExpressions.list(fixture.cache())).find((row) => row.name === BASE_REGEX_NAME);
  assertExists(restored);
  assertEquals(restored.description, 'edited description');
  const snapshot = await listOverrides(fixture.databaseId);
  assertEquals(
    snapshot.entities.map((entity) => `${entity.name}:${entity.kind}`),
    [`${BASE_REGEX_NAME}:modified`]
  );
});

overridesTest('undo: does not reactivate an op superseded within the undone action itself', async (fixture) => {
  // One action: edit then delete the same entity. The delete supersedes the edit in-request.
  await withUserOpAction(async () => {
    await updateRegex(fixture, BASE_REGEX_NAME, { description: 'edited description' });
    await deleteRegex(fixture, BASE_REGEX_NAME);
  });
  const [deleteOp] = publishedUserOpIds(fixture);
  const superseded = pcdOpsQueries
    .listByDatabase(fixture.databaseId)
    .filter((op) => op.origin === 'user' && op.state === 'superseded');
  assertEquals(superseded.length, 1);

  const result = await undoLastAction({ databaseId: fixture.databaseId });
  assertEquals(result.revertedOpIds, [deleteOp]);
  assertEquals(result.reactivatedOpIds, []);
  assertEquals(pcdOpsQueries.getById(superseded[0].id)?.state, 'superseded');
  assertEquals(publishedUserOpIds(fixture), []);
});

overridesTest('undo: manual conflict override restores its original pending conflict', async (fixture) => {
  databaseInstancesQueries.update(fixture.databaseId, { conflictStrategy: 'ask' });
  const originalId = pcdOpsQueries.create({
    databaseId: fixture.databaseId,
    origin: 'user',
    state: 'published',
    source: 'local',
    sql: `UPDATE regular_expressions SET pattern = 'local-pattern' WHERE name = '${BASE_REGEX_NAME}' AND pattern = 'old-upstream';`,
    metadata: JSON.stringify({
      operation: 'update',
      entity: 'regular_expression',
      name: BASE_REGEX_NAME,
      stable_key: { key: 'regular_expression_name', value: BASE_REGEX_NAME },
      changed_fields: ['pattern'],
    }),
    desiredState: JSON.stringify({ pattern: { from: 'old-upstream', to: 'local-pattern' } }),
  });
  await compile(fixture.pcdPath, fixture.databaseId);
  assert(['conflicted', 'conflicted_pending'].includes(pcdOpHistoryQueries.listByOp(originalId)[0].status));

  const overridden = await withUserOpAction(() =>
    overrideConflict({ databaseId: fixture.databaseId, opId: originalId })
  );
  assertEquals(overridden.success, true);
  assertEquals(pcdOpsQueries.getById(originalId)?.state, 'superseded');
  const replacementIds = publishedUserOpIds(fixture);
  assert(replacementIds.length > 0);
  assertEquals(
    patternOf(await readResolvedEntity(fixture.cache(), 'regularExpression', undefined, BASE_REGEX_NAME)),
    'local-pattern'
  );

  const undone = await undoLastAction({ databaseId: fixture.databaseId });
  assertEquals(undone.revertedOpIds, replacementIds);
  assertEquals(undone.reactivatedOpIds, [originalId]);
  assertEquals(pcdOpsQueries.getById(originalId)?.state, 'published');
  assertEquals(pcdOpsQueries.getById(originalId)?.superseded_by_op_id, null);
  assertEquals(
    pcdOpHistoryQueries.listLatestConflictsByDatabase(fixture.databaseId).map((row) => row.op.id),
    [originalId]
  );
  assertEquals(
    patternOf(await readResolvedEntity(fixture.cache(), 'regularExpression', undefined, BASE_REGEX_NAME)),
    BASE_REGEX_PATTERN
  );
});

overridesTest('undo: unbuilt/disabled database is the typed not-found error (400 contract)', async (fixture) => {
  await updateRegex(fixture, BASE_REGEX_NAME, { description: 'edited description' });
  await assertRejects(() => undoLastAction({ databaseId: 987654 }), ResolvedConfigDatabaseNotFoundError);
});

overridesTest(
  'auto override: each conflict override gets its own action, not the triggering request action',
  async (fixture) => {
    databaseInstancesQueries.update(fixture.databaseId, { conflictStrategy: 'override' });
    pcdOpsQueries.create({
      databaseId: fixture.databaseId,
      origin: 'user',
      state: 'published',
      source: 'local',
      sql: "UPDATE custom_formats SET description = 'x' WHERE name = 'Auto CF' AND description = 'never'",
      metadata: JSON.stringify({ operation: 'create', entity: 'custom_format', name: 'Auto CF' }),
      desiredState: JSON.stringify({ name: 'Auto CF', description: 'auto' }),
    });

    const before = new Set(pcdOpsQueries.listByDatabase(fixture.databaseId).map((op) => op.id));
    await withUserOpAction(async () => {
      assertEquals(currentUserOpActionId() !== undefined, true);
      const requestAction = currentUserOpActionId();
      await compile(fixture.pcdPath, fixture.databaseId);
      const created = pcdOpsQueries
        .listByDatabaseAndOrigin(fixture.databaseId, 'user', { states: ['published'] })
        .filter((op) => !before.has(op.id));
      assert(created.length > 0, 'automatic override should write replacement ops');
      for (const op of created) {
        const actionId = parseUserOpMetadata(op.metadata).actionId;
        assertExists(actionId);
        assert(actionId !== requestAction, 'auto override must not reuse the request action');
      }
    });
  }
);
