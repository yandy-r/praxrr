import { assertEquals, assertNotEquals, assertRejects } from '@std/assert';
import type { OperationMetadata } from '$pcd/core/types.ts';
import {
  currentUserOpActionId,
  runOutsideUserOpAction,
  withNewUserOpAction,
  withUserOpAction,
} from '$pcd/ops/actionContext.ts';
import { __testOnly_buildMetadataJson } from '$pcd/ops/writer.ts';

Deno.test('writer action id: serialization preserves existing metadata keys', () => {
  const metadata: OperationMetadata = {
    operation: 'update',
    entity: 'regular_expression',
    name: 'New name',
    previousName: 'Old name',
    summary: 'Updated pattern',
    title: 'Edit regular expression',
    changedFields: ['pattern'],
    stableKey: { key: 'name', value: 'Old name' },
    groupId: 'dependency-group',
    actionId: 'request-action',
    generated: true,
    dependsOn: [{ entity: 'custom_format', key: 'name', value: 'Format' }],
  };

  assertEquals(JSON.parse(__testOnly_buildMetadataJson(metadata)!), {
    operation: 'update',
    entity: 'regular_expression',
    name: 'New name',
    previousName: 'Old name',
    summary: 'Updated pattern',
    title: 'Edit regular expression',
    changed_fields: ['pattern'],
    stable_key: { key: 'name', value: 'Old name' },
    group_id: 'dependency-group',
    action_id: 'request-action',
    generated: true,
    depends_on: [{ entity: 'custom_format', key: 'name', value: 'Format' }],
  });
});

Deno.test('writer action id: serialization omits action_id when unset', () => {
  assertEquals(
    JSON.parse(
      __testOnly_buildMetadataJson({
        operation: 'create',
        entity: 'regular_expression',
        name: 'Regex',
      })!
    ),
    { operation: 'create', entity: 'regular_expression', name: 'Regex' }
  );
  assertEquals(__testOnly_buildMetadataJson(), null);
});

Deno.test('writer action id: scope survives awaits and nested scopes preserve the outer id', async () => {
  assertEquals(currentUserOpActionId(), undefined);

  const result = await withUserOpAction(async () => {
    assertEquals(currentUserOpActionId(), 'outer-action');
    await Promise.resolve();
    assertEquals(currentUserOpActionId(), 'outer-action');
    await withUserOpAction(async () => {
      await Promise.resolve();
      assertEquals(currentUserOpActionId(), 'outer-action');
    }, 'nested-action');
    assertEquals(currentUserOpActionId(), 'outer-action');
    return 'result';
  }, 'outer-action');

  assertEquals(result, 'result');
  assertEquals(currentUserOpActionId(), undefined);
});

Deno.test('writer action id: independent and concurrent scopes have distinct ids', async () => {
  const ids = await Promise.all(
    [0, 1].map(() =>
      withUserOpAction(async () => {
        const before = currentUserOpActionId();
        await Promise.resolve();
        assertEquals(currentUserOpActionId(), before);
        assertNotEquals(before, undefined);
        return before;
      })
    )
  );

  assertNotEquals(ids[0], ids[1]);
  assertEquals(currentUserOpActionId(), undefined);
});

Deno.test('writer action id: failed scope does not leak its context', async () => {
  await assertRejects(
    () =>
      withUserOpAction(async () => {
        await Promise.resolve();
        throw new Error('failed action');
      }, 'failed-action'),
    Error,
    'failed action'
  );

  assertEquals(currentUserOpActionId(), undefined);
});

Deno.test('writer action id: withNewUserOpAction opens a fresh action inside an outer one', async () => {
  await withUserOpAction(async () => {
    const outer = currentUserOpActionId();
    const inner = await withNewUserOpAction(async () => {
      await Promise.resolve();
      return currentUserOpActionId();
    });
    assertNotEquals(inner, undefined);
    assertNotEquals(inner, outer);
    assertEquals(currentUserOpActionId(), outer);
  }, 'outer-action');
});

Deno.test('writer action id: timer armed inside an action runs outside it via runOutsideUserOpAction', async () => {
  const seen = await withUserOpAction(
    () =>
      new Promise<string | undefined>((resolve) => {
        setTimeout(() => runOutsideUserOpAction(() => resolve(currentUserOpActionId())), 1);
      }),
    'request-action'
  );
  assertEquals(seen, undefined);
});
