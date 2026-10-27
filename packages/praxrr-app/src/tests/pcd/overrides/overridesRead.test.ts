import { assert, assertEquals, assertExists } from '@std/assert';
import { buildLocallyModifiedLookup, listLocallyModifiedEntities, listOverrides } from '$pcd/overrides/index.ts';
import * as delayProfiles from '$pcd/entities/delayProfiles/index.ts';
import * as regularExpressions from '$pcd/entities/regularExpressions/index.ts';
import * as customFormats from '$pcd/entities/customFormats/index.ts';
import {
  BASE_CUSTOM_FORMAT_NAME,
  BASE_DELAY_PROFILE_NAME,
  BASE_REGEX_NAME,
  DOOMED_REGEX_NAME,
  overridesTest,
  UNTOUCHED_REGEX_NAME,
  type PcdFixture,
} from './overridesTestHelpers.ts';

const RENAMED_DELAY_PROFILE_NAME = 'Renamed Delay';
const CREATED_CF_NAME = 'User Created CF';

async function editBaseRegexPattern(fixture: PcdFixture): Promise<void> {
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = (await regularExpressions.list(cache)).find((row) => row.name === BASE_REGEX_NAME);
    assertExists(current);
    return regularExpressions.update({
      databaseId,
      cache,
      layer: 'user',
      current,
      input: {
        name: BASE_REGEX_NAME,
        pattern: 'edited-pattern',
        tags: [],
        description: current.description,
        regex101Id: current.regex101_id,
      },
    });
  });
}

async function renameBaseDelayProfile(fixture: PcdFixture): Promise<void> {
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = await delayProfiles.getByName(cache, BASE_DELAY_PROFILE_NAME);
    assertExists(current);
    return delayProfiles.update({
      databaseId,
      cache,
      layer: 'user',
      current,
      input: {
        name: RENAMED_DELAY_PROFILE_NAME,
        preferredProtocol: current.preferred_protocol,
        usenetDelay: current.usenet_delay ?? 0,
        torrentDelay: 250,
        bypassIfHighestQuality: current.bypass_if_highest_quality,
        bypassIfAboveCfScore: current.bypass_if_above_custom_format_score,
        minimumCfScore: current.minimum_custom_format_score ?? 0,
      },
    });
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

async function deleteDoomedRegex(fixture: PcdFixture): Promise<void> {
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = (await regularExpressions.list(cache)).find((row) => row.name === DOOMED_REGEX_NAME);
    assertExists(current);
    return regularExpressions.remove({ databaseId, cache, layer: 'user', current });
  });
}

overridesTest('listOverrides: no user ops yields an empty snapshot', async (fixture) => {
  const snapshot = await listOverrides(fixture.databaseId);
  assertEquals(snapshot.entities, []);
  assertEquals(snapshot.lastAction, null);
  assertEquals(snapshot.unmappedOpCount, 0);
});

overridesTest('listOverrides: edit and rename report modified entities addressed by current name', async (fixture) => {
  await editBaseRegexPattern(fixture);
  await renameBaseDelayProfile(fixture);

  const snapshot = await listOverrides(fixture.databaseId);
  const byKey = new Map(snapshot.entities.map((entity) => [`${entity.entityType}|${entity.name}`, entity]));
  assertEquals(snapshot.entities.length, 2);

  const regex = byKey.get(`regularExpression|${BASE_REGEX_NAME}`);
  assertExists(regex);
  assertEquals(regex.kind, 'modified');
  assertEquals(regex.arrType, null);
  assertEquals(regex.present, true);
  assertEquals(regex.existsInBase, true);
  assert(regex.overrides.length > 0);
  assert(regex.overrides.some((change) => change.field === 'pattern'));
  assert(regex.ops.length >= 1);
  assertEquals(regex.ops[0].operation, 'update');
  assert(regex.ops[0].actionId, 'user ops carry an action id');

  // Rename is addressed by the NEW name; the old name is no longer an override target.
  const delay = byKey.get(`delayProfile|${RENAMED_DELAY_PROFILE_NAME}`);
  assertExists(delay);
  assertEquals(delay.kind, 'modified');
  assertEquals(delay.present, true);
  assertEquals(delay.existsInBase, true, 'the renamed entity exists upstream under its original name');
  assert(delay.overrides.some((change) => change.field === 'name'));
  assert(delay.overrides.length > 1);
  assertEquals(byKey.has(`delayProfile|${BASE_DELAY_PROFILE_NAME}`), false);
});

overridesTest('listOverrides: user-created custom format is kind=created', async (fixture) => {
  await createCustomFormat(fixture);

  const snapshot = await listOverrides(fixture.databaseId);
  assertEquals(snapshot.entities.length, 1);
  const [created] = snapshot.entities;
  assertEquals(created.entityType, 'customFormat');
  assertEquals(created.name, CREATED_CF_NAME);
  assertEquals(created.kind, 'created');
  assertEquals(created.present, true);
  assertEquals(created.existsInBase, false);
  assert(created.overrides.length > 0);
  assert(created.ops.some((op) => op.operation === 'create'));
});

overridesTest('listOverrides: user-deleted base regex is kind=deleted and not present', async (fixture) => {
  await deleteDoomedRegex(fixture);

  const snapshot = await listOverrides(fixture.databaseId, { entityType: 'regularExpression' });
  assertEquals(snapshot.entities.length, 1);
  const [deleted] = snapshot.entities;
  assertEquals(deleted.name, DOOMED_REGEX_NAME);
  assertEquals(deleted.kind, 'deleted');
  assertEquals(deleted.present, false);
  assertEquals(deleted.existsInBase, true);
  assert(deleted.ops.some((op) => op.operation === 'delete'));
});

overridesTest('listOverrides: entityType filter and lastAction', async (fixture) => {
  await editBaseRegexPattern(fixture);
  await createCustomFormat(fixture);

  const onlyRegex = await listOverrides(fixture.databaseId, { entityType: 'regularExpression' });
  assertEquals(
    onlyRegex.entities.map((entity) => entity.name),
    [BASE_REGEX_NAME]
  );

  const all = await listOverrides(fixture.databaseId);
  assertExists(all.lastAction);
  // The last action is the CF create (its own user action), not the earlier regex edit.
  assertEquals(
    all.lastAction.entities.map((entity) => `${entity.entityType}|${entity.name}`),
    [`customFormat|${CREATED_CF_NAME}`]
  );
  const cfOpIds = all.entities.find((entity) => entity.entityType === 'customFormat')?.ops.map((op) => op.id) ?? [];
  assertEquals(
    all.lastAction.opIds,
    [...cfOpIds].sort((a, b) => a - b)
  );
  assertEquals(all.lastAction.key, `action:${all.lastAction.actionId}`);
});

overridesTest('buildLocallyModifiedLookup: true exactly for touched entities', async (fixture) => {
  await editBaseRegexPattern(fixture);
  await renameBaseDelayProfile(fixture);
  await createCustomFormat(fixture);
  await deleteDoomedRegex(fixture);

  const lookup = buildLocallyModifiedLookup(fixture.databaseId);
  assertEquals(lookup('regularExpression', undefined, BASE_REGEX_NAME), true);
  assertEquals(lookup('delayProfile', undefined, RENAMED_DELAY_PROFILE_NAME), true);
  assertEquals(lookup('customFormat', undefined, CREATED_CF_NAME), true);
  assertEquals(lookup('regularExpression', undefined, DOOMED_REGEX_NAME), true);

  // Untouched entities and the pre-rename name are not flagged.
  assertEquals(lookup('regularExpression', undefined, UNTOUCHED_REGEX_NAME), false);
  assertEquals(lookup('customFormat', undefined, BASE_CUSTOM_FORMAT_NAME), false);
  assertEquals(lookup('delayProfile', undefined, BASE_DELAY_PROFILE_NAME), false);
  // Same name, different entity type.
  assertEquals(lookup('customFormat', undefined, BASE_REGEX_NAME), false);

  const refs = listLocallyModifiedEntities(fixture.databaseId);
  assertEquals(refs.length, 4);
});

overridesTest('buildLocallyModifiedLookup: arr-scoped types do not leak across Arr apps', async (fixture) => {
  fixture.insertUserOp({
    metadata: {
      operation: 'update',
      entity: 'radarr_naming',
      name: 'Shared Naming',
      stable_key: { key: 'radarr_naming_name', value: 'Shared Naming' },
      changed_fields: ['rename'],
    },
  });

  const lookup = buildLocallyModifiedLookup(fixture.databaseId);
  assertEquals(lookup('naming', 'radarr', 'Shared Naming'), true);
  assertEquals(lookup('naming', 'sonarr', 'Shared Naming'), false);
  assertEquals(lookup('naming', 'lidarr', 'Shared Naming'), false);
  assertEquals(lookup('naming', undefined, 'Shared Naming'), false);

  assertEquals(listLocallyModifiedEntities(fixture.databaseId), [
    { entityType: 'naming', arrType: 'radarr', name: 'Shared Naming' },
  ]);
});

overridesTest('listOverrides: unknown-entity ops count as unmapped and are not listed', async (fixture) => {
  const opId = fixture.insertUserOp({
    metadata: { operation: 'update', entity: 'test_entity', name: 'Some Test Entity' },
  });
  const malformedId = fixture.insertUserOp({ metadata: null });

  const snapshot = await listOverrides(fixture.databaseId);
  assertEquals(snapshot.entities, []);
  assertEquals(snapshot.unmappedOpCount, 2);
  // Unmapped ops still define the latest undoable action.
  assertExists(snapshot.lastAction);
  assertEquals(snapshot.lastAction.key, `op:${malformedId}`);
  assertEquals(snapshot.lastAction.opIds, [malformedId]);
  assertEquals(snapshot.lastAction.entities, []);
  assert(opId < malformedId);

  const lookup = buildLocallyModifiedLookup(fixture.databaseId);
  assertEquals(lookup('regularExpression', undefined, 'Some Test Entity'), false);
});
