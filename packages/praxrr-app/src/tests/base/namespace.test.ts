import { assertEquals, assertNotEquals, assertThrows } from '@std/assert';
import { getNamespaceSuffix, getTrashGuideNamespaceSuffix } from '$sync/namespace.ts';

Deno.test('getTrashGuideNamespaceSuffix: maps index to prefixed zero-width suffix', () => {
  assertEquals(getTrashGuideNamespaceSuffix(1), '\u200C\u200B');
  assertEquals(getTrashGuideNamespaceSuffix(2), '\u200C\u200B\u200B');
  assertEquals(getTrashGuideNamespaceSuffix(3), '\u200C\u200B\u200B\u200B');
});

Deno.test('getTrashGuideNamespaceSuffix: is disjoint from DB namespace index 1', () => {
  assertNotEquals(getTrashGuideNamespaceSuffix(1), getNamespaceSuffix(1));
  assertNotEquals(getTrashGuideNamespaceSuffix(2), getNamespaceSuffix(2));
});

Deno.test('getTrashGuideNamespaceSuffix: rejects invalid indexes', () => {
  assertThrows(() => getTrashGuideNamespaceSuffix(0), Error, 'Invalid TRaSH namespace index: 0');
});
