import { assertEquals, assertStrictEquals } from '@std/assert';

import { wrapIndex } from '../../lib/client/utils/focusTrap.ts';
import { moveItem } from '../../lib/client/ui/table/reorder.ts';

Deno.test('wrapIndex wraps forward and backward', () => {
  assertEquals(wrapIndex(0, 1, 3), 1);
  assertEquals(wrapIndex(2, 1, 3), 0);
  assertEquals(wrapIndex(1, -1, 3), 0);
  assertEquals(wrapIndex(0, -1, 3), 2);
});

Deno.test('wrapIndex returns 0 for length 0 and stays put for length 1', () => {
  assertEquals(wrapIndex(0, 1, 0), 0);
  assertEquals(wrapIndex(4, -1, 0), 0);
  assertEquals(wrapIndex(0, 1, 1), 0);
  assertEquals(wrapIndex(0, -1, 1), 0);
});

Deno.test('moveItem moves down and up without mutating the input', () => {
  const items = ['a', 'b', 'c'];

  assertEquals(moveItem(items, 0, 2), ['b', 'c', 'a']);
  assertEquals(moveItem(items, 2, 0), ['c', 'a', 'b']);
  assertEquals(items, ['a', 'b', 'c']);
});

Deno.test('moveItem is a no-op out of range and does not copy the input', () => {
  const items = ['a', 'b', 'c'];

  assertStrictEquals(moveItem(items, -1, 0), items);
  assertStrictEquals(moveItem(items, 0, -1), items);
  assertStrictEquals(moveItem(items, 3, 0), items);
  assertStrictEquals(moveItem(items, 0, 3), items);
  assertStrictEquals(moveItem(items, 1, 1), items);
  assertEquals(items, ['a', 'b', 'c']);
});
