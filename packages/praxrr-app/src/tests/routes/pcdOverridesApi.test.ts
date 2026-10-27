// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertExists } from '@std/assert';
import type { components } from '$api/v1.d.ts';
import { API_TOKEN_SCOPES } from '$shared/auth/apiTokenScopes.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import * as regularExpressions from '$pcd/entities/regularExpressions/index.ts';
import * as customFormats from '$pcd/entities/customFormats/index.ts';
import { GET as GET_LIST } from '../../routes/api/v1/pcd/[databaseId]/overrides/+server.ts';
import { POST as POST_UNDO } from '../../routes/api/v1/pcd/[databaseId]/overrides/undo/+server.ts';
import { POST as POST_REVERT } from '../../routes/api/v1/pcd/[databaseId]/overrides/[entityType]/[name]/revert/+server.ts';
import { GET as GET_NAMED } from '../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts';
import {
  BASE_CUSTOM_FORMAT_NAME,
  BASE_QUALITY_PROFILE_NAME,
  BASE_REGEX_NAME,
  DEFAULT_BASE_OPS,
  DOOMED_REGEX_NAME,
  overridesTest,
  type PcdFixture,
} from '../pcd/overrides/overridesTestHelpers.ts';

type ListEvent = Parameters<typeof GET_LIST>[0];
type UndoEvent = Parameters<typeof POST_UNDO>[0];
type RevertEvent = Parameters<typeof POST_REVERT>[0];
type NamedEvent = Parameters<typeof GET_NAMED>[0];
type PcdOverridesResponse = components['schemas']['PcdOverridesResponse'];
type PcdOverrideRevertResult = components['schemas']['PcdOverrideRevertResult'];
type PcdOverrideUndoResult = components['schemas']['PcdOverrideUndoResult'];
type PcdOverrideErrorResponse = components['schemas']['PcdOverrideErrorResponse'];
type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type ErrorResponse = components['schemas']['ErrorResponse'];

const SCORING_BASE_OP = `INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score) VALUES ('${BASE_QUALITY_PROFILE_NAME}', '${BASE_CUSTOM_FORMAT_NAME}', 'radarr', 100);`;

function buildLocals(authenticated: boolean): App.Locals {
  return authenticated
    ? {
        user: {
          id: 1,
          username: 'user-1',
          password_hash: 'hash',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        session: null,
        authBypass: false,
        principal: { kind: 'session', scopes: API_TOKEN_SCOPES },
      }
    : { user: null, session: null, authBypass: false, principal: null };
}

function listEvent(databaseId: string, query = '', authenticated = true): ListEvent {
  const event: Partial<ListEvent> = {
    url: new URL(`http://localhost/api/v1/pcd/${databaseId}/overrides${query}`),
    params: { databaseId },
    locals: buildLocals(authenticated),
  };
  return event as ListEvent;
}

function undoEvent(databaseId: string, body: unknown, authenticated = true): UndoEvent {
  const event: Partial<UndoEvent> = {
    url: new URL(`http://localhost/api/v1/pcd/${databaseId}/overrides/undo`),
    params: { databaseId },
    locals: buildLocals(authenticated),
    request: new Request(`http://localhost/api/v1/pcd/${databaseId}/overrides/undo`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  };
  return event as UndoEvent;
}

function revertEvent(
  databaseId: string,
  entityType: string,
  name: string,
  query: string,
  body: unknown,
  authenticated = true
): RevertEvent {
  const url = `http://localhost/api/v1/pcd/${databaseId}/overrides/${entityType}/${encodeURIComponent(name)}/revert${query}`;
  const event: Partial<RevertEvent> = {
    url: new URL(url),
    params: { databaseId, entityType, name },
    locals: buildLocals(authenticated),
    request: new Request(url, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  };
  return event as RevertEvent;
}

function namedEvent(databaseId: string, entityType: string, name: string, query: string): NamedEvent {
  const event: Partial<NamedEvent> = {
    url: new URL(
      `http://localhost/api/v1/pcd/${databaseId}/resolved/${entityType}/${encodeURIComponent(name)}${query}`
    ),
    params: { databaseId, entityType, name },
    locals: buildLocals(true),
  };
  return event as NamedEvent;
}

async function getOverrides(fixture: PcdFixture, query = ''): Promise<PcdOverridesResponse> {
  const response = await GET_LIST(listEvent(String(fixture.databaseId), query));
  assertEquals(response.status, 200);
  return (await response.json()) as PcdOverridesResponse;
}

async function updateRegex(fixture: PcdFixture, name: string, pattern: string): Promise<void> {
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = (await regularExpressions.list(cache)).find((row) => row.name === name);
    assertExists(current);
    return regularExpressions.update({
      databaseId,
      cache,
      layer: 'user',
      current,
      input: {
        name: current.name,
        pattern,
        tags: [],
        description: current.description,
        regex101Id: current.regex101_id,
      },
    });
  });
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

function publishedUserOpIds(fixture: PcdFixture): number[] {
  return pcdOpsQueries
    .listByDatabaseAndOrigin(fixture.databaseId, 'user', { states: ['published'] })
    .map((op) => op.id);
}

overridesTest('GET lists grouped entities with deltas and lastAction', async (fixture) => {
  await updateRegex(fixture, BASE_REGEX_NAME, 'edited-pattern');
  await updateRegex(fixture, DOOMED_REGEX_NAME, 'other-edit');

  const body = await getOverrides(fixture);
  assertEquals(body.databaseId, fixture.databaseId);
  assertEquals(body.unmappedOpCount, 0);
  assertEquals(
    body.entities.map((entity) => [entity.entityType, entity.arrType, entity.name, entity.kind]),
    [
      ['regularExpression', null, BASE_REGEX_NAME, 'modified'],
      ['regularExpression', null, DOOMED_REGEX_NAME, 'modified'],
    ]
  );
  const [regex] = body.entities;
  assertEquals(regex.present, true);
  assertEquals(regex.existsInBase, true);
  assert(regex.overrides.some((change) => change.field === 'pattern'));
  assertEquals(regex.ops.length, 1);
  assertExists(body.lastAction);
  assertEquals(body.lastAction.entities, [{ entityType: 'regularExpression', arrType: null, name: DOOMED_REGEX_NAME }]);

  // Filtering narrows entities but never changes lastAction.
  const filtered = await getOverrides(fixture, '?entityType=customFormat');
  assertEquals(filtered.entities, []);
  assertEquals(filtered.lastAction, body.lastAction);
});

overridesTest('GET validates entityType/arrType/databaseId and requires auth', async (fixture) => {
  const id = String(fixture.databaseId);

  const unauth = await GET_LIST(listEvent(id, '', false));
  assertEquals(unauth.status, 401);

  const badId = await GET_LIST(listEvent('1abc'));
  assertEquals(badId.status, 400);

  const unknownDb = await GET_LIST(listEvent('987654'));
  assertEquals(unknownDb.status, 400);
  assertEquals(((await unknownDb.json()) as ErrorResponse).error, 'Database not found');

  for (const query of [
    '?entityType=bogus',
    '?arrType=bogus',
    '?entityType=regularExpression&arrType=radarr',
    '?entityType=naming',
    '?entityType=lidarrMetadataProfile&arrType=radarr',
  ]) {
    const response = await GET_LIST(listEvent(id, query));
    assertEquals(response.status, 400, query);
  }

  const ok = await GET_LIST(listEvent(id, '?entityType=naming&arrType=radarr'));
  assertEquals(ok.status, 200);
});

overridesTest('POST revert validates input and requires auth', async (fixture) => {
  const id = String(fixture.databaseId);
  await updateRegex(fixture, BASE_REGEX_NAME, 'edited-pattern');
  const before = publishedUserOpIds(fixture);

  const unauth = await POST_REVERT(revertEvent(id, 'regularExpression', BASE_REGEX_NAME, '', {}, false));
  assertEquals(unauth.status, 401);

  const cases: [string, string, string, unknown][] = [
    ['bogus', BASE_REGEX_NAME, '', {}],
    ['regularExpression', BASE_REGEX_NAME, '?arrType=radarr', {}],
    ['naming', 'Anything', '', {}],
    ['regularExpression', BASE_REGEX_NAME, '', '{not json'],
    ['regularExpression', BASE_REGEX_NAME, '', []],
    ['regularExpression', BASE_REGEX_NAME, '', { opIds: [] }],
    ['regularExpression', BASE_REGEX_NAME, '', { opIds: [0] }],
    ['regularExpression', BASE_REGEX_NAME, '', { opIds: [1.5] }],
    ['regularExpression', BASE_REGEX_NAME, '', { opIds: Array.from({ length: 1001 }, (_, i) => i + 1) }],
    ['regularExpression', BASE_REGEX_NAME, '', { cascadeGroup: 'yes' }],
    ['regularExpression', BASE_REGEX_NAME, '', { padding: 'x'.repeat(9 * 1024) }],
  ];
  for (const [entityType, name, query, body] of cases) {
    const response = await POST_REVERT(revertEvent(id, entityType, name, query, body));
    assertEquals(response.status, 400, `${entityType} ${query} ${JSON.stringify(body).slice(0, 40)}`);
  }
  assertEquals(publishedUserOpIds(fixture), before);

  const unknownDb = await POST_REVERT(revertEvent('987654', 'regularExpression', BASE_REGEX_NAME, '', {}));
  assertEquals(unknownDb.status, 400);
});

overridesTest('POST revert (all) clears the entity and the resolved user layer (AC2)', async (fixture) => {
  const id = String(fixture.databaseId);
  await updateRegex(fixture, BASE_REGEX_NAME, 'edited-pattern');
  await updateRegex(fixture, DOOMED_REGEX_NAME, 'other-edit');
  const [regexOpId] = (await getOverrides(fixture)).entities[0].ops.map((op) => op.id);

  const response = await POST_REVERT(revertEvent(id, 'regularExpression', BASE_REGEX_NAME, '', {}));
  assertEquals(response.status, 200);
  const result = (await response.json()) as PcdOverrideRevertResult;
  assertEquals(result.databaseId, fixture.databaseId);
  assertEquals(result.entityType, 'regularExpression');
  assertEquals(result.name, BASE_REGEX_NAME);
  assertEquals(result.revertedOpIds, [regexOpId]);
  assertEquals(result.remainingOpIds, []);
  assertEquals(result.cascadedEntities, []);
  assertEquals(result.resolvedMatchesBase, true);

  const after = await getOverrides(fixture);
  assertEquals(
    after.entities.map((entity) => entity.name),
    [DOOMED_REGEX_NAME]
  );

  const named = await GET_NAMED(namedEvent(id, 'regularExpression', BASE_REGEX_NAME, '?layer=user'));
  assertEquals(named.status, 200);
  const state = (await named.json()) as ResolvedEntityState;
  assertEquals(state.layer, 'user');
  assertEquals(state.overrides, []);
});

overridesTest('POST revert with opIds is partial; repeated revert is 409 op_not_revertible', async (fixture) => {
  const id = String(fixture.databaseId);
  await updateRegex(fixture, BASE_REGEX_NAME, 'first-pattern');
  await fixture.writeUserEdit(async (cache, databaseId) => {
    const current = (await regularExpressions.list(cache)).find((row) => row.name === BASE_REGEX_NAME);
    assertExists(current);
    return regularExpressions.update({
      databaseId,
      cache,
      layer: 'user',
      current,
      input: {
        name: current.name,
        pattern: current.pattern,
        tags: [],
        description: 'edited description',
        regex101Id: current.regex101_id,
      },
    });
  });
  const entity = (await getOverrides(fixture)).entities[0];
  assertEquals(entity.ops.length, 2);
  const [patternOp, descriptionOp] = entity.ops.map((op) => op.id);

  const response = await POST_REVERT(revertEvent(id, 'regularExpression', BASE_REGEX_NAME, '', { opIds: [patternOp] }));
  assertEquals(response.status, 200);
  const result = (await response.json()) as PcdOverrideRevertResult;
  assertEquals(result.revertedOpIds, [patternOp]);
  assertEquals(result.remainingOpIds, [descriptionOp]);
  assertEquals(result.resolvedMatchesBase, null);
  assertEquals(publishedUserOpIds(fixture), [descriptionOp]);

  const again = await POST_REVERT(revertEvent(id, 'regularExpression', BASE_REGEX_NAME, '', { opIds: [patternOp] }));
  assertEquals(again.status, 409);
  const error = (await again.json()) as PcdOverrideErrorResponse;
  assertEquals(error.reason, 'op_not_revertible');
  assertEquals(error.blockingOpIds, [patternOp]);
});

overridesTest('POST revert maps unknown entity and unknown op to 404', async (fixture) => {
  const id = String(fixture.databaseId);
  await updateRegex(fixture, BASE_REGEX_NAME, 'edited-pattern');

  const entity = await POST_REVERT(revertEvent(id, 'regularExpression', 'No Such Regex', '', {}));
  assertEquals(entity.status, 404);
  assertEquals(((await entity.json()) as PcdOverrideErrorResponse).reason, 'entity_not_found');

  const op = await POST_REVERT(revertEvent(id, 'regularExpression', BASE_REGEX_NAME, '', { opIds: [987654] }));
  assertEquals(op.status, 404);
  assertEquals(((await op.json()) as PcdOverrideErrorResponse).reason, 'op_not_found');
});

overridesTest(
  'POST revert returns 409 group_dependency with entities unless cascadeGroup',
  async (fixture) => {
    const id = String(fixture.databaseId);
    await deleteBaseCustomFormat(fixture);
    const before = publishedUserOpIds(fixture);

    const blocked = await POST_REVERT(revertEvent(id, 'customFormat', BASE_CUSTOM_FORMAT_NAME, '', {}));
    assertEquals(blocked.status, 409);
    const error = (await blocked.json()) as PcdOverrideErrorResponse;
    assertEquals(error.reason, 'group_dependency');
    assertEquals(error.entities, [{ entityType: 'qualityProfile', arrType: null, name: BASE_QUALITY_PROFILE_NAME }]);
    assertEquals(publishedUserOpIds(fixture), before);

    const cascaded = await POST_REVERT(
      revertEvent(id, 'customFormat', BASE_CUSTOM_FORMAT_NAME, '', { cascadeGroup: true })
    );
    assertEquals(cascaded.status, 200);
    const result = (await cascaded.json()) as PcdOverrideRevertResult;
    assertEquals(result.cascadedEntities, [
      { entityType: 'qualityProfile', arrType: null, name: BASE_QUALITY_PROFILE_NAME },
    ]);
    assertEquals(publishedUserOpIds(fixture), []);
  },
  { baseOps: [...DEFAULT_BASE_OPS, SCORING_BASE_OP] }
);

overridesTest(
  'POST undo reverts exactly the latest action (AC3), guards stale ids, 404 when empty',
  async (fixture) => {
    const id = String(fixture.databaseId);

    const empty = await POST_UNDO(undoEvent(id, {}));
    assertEquals(empty.status, 404);
    assertEquals(((await empty.json()) as PcdOverrideErrorResponse).reason, 'nothing_to_undo');

    await updateRegex(fixture, BASE_REGEX_NAME, 'edited-pattern');
    await updateRegex(fixture, DOOMED_REGEX_NAME, 'other-edit');
    const snapshot = await getOverrides(fixture);
    assertExists(snapshot.lastAction);
    const doomedOpIds = snapshot.entities.find((entity) => entity.name === DOOMED_REGEX_NAME)?.ops.map((op) => op.id);
    assertExists(doomedOpIds);

    assertEquals((await POST_UNDO(undoEvent('1abc', {}))).status, 400);
    assertEquals((await POST_UNDO(undoEvent(id, {}, false))).status, 401);
    assertEquals((await POST_UNDO(undoEvent(id, '{not json'))).status, 400);
    assertEquals((await POST_UNDO(undoEvent(id, { expectedActionId: 5 }))).status, 400);
    assertEquals((await POST_UNDO(undoEvent(id, { expectedActionId: 'x'.repeat(65) }))).status, 400);

    const before = publishedUserOpIds(fixture);
    const stale = await POST_UNDO(undoEvent(id, { expectedActionId: 'not-the-last-action' }));
    assertEquals(stale.status, 409);
    assertEquals(((await stale.json()) as PcdOverrideErrorResponse).reason, 'stale_action');
    assertEquals(publishedUserOpIds(fixture), before);

    const response = await POST_UNDO(undoEvent(id, { expectedActionId: snapshot.lastAction.actionId }));
    assertEquals(response.status, 200);
    const result = (await response.json()) as PcdOverrideUndoResult;
    assertEquals(result.databaseId, fixture.databaseId);
    assertEquals(result.undoneActionId, snapshot.lastAction.actionId);
    assertEquals(result.revertedOpIds, doomedOpIds);
    assertEquals(result.reactivatedOpIds, []);
    assertEquals(result.entities, [{ entityType: 'regularExpression', arrType: null, name: DOOMED_REGEX_NAME }]);

    const after = await getOverrides(fixture);
    assertEquals(
      after.entities.map((entity) => entity.name),
      [BASE_REGEX_NAME]
    );
  }
);
