/**
 * Tests for groupSeriesByParentFolder() from rename/folderGroups.ts
 *
 * Sonarr folder renames send `PUT /series/editor { rootFolderPath, moveFiles: true }`;
 * any series batched under the wrong root is physically moved there.
 */

import { assertEquals } from '@std/assert';
import { groupSeriesByParentFolder, parentFolderOf } from '../../lib/server/rename/folderGroups.ts';

function groups(series: { id: number; path?: string }[]) {
  const result = groupSeriesByParentFolder(series);
  return {
    groups: Object.fromEntries(result.groups),
    unresolved: result.unresolved.map((s) => s.id),
  };
}

Deno.test('rename folder groups: sibling roots sharing a prefix stay separate', () => {
  assertEquals(
    groups([
      { id: 1, path: '/tv/Show A' },
      { id: 2, path: '/tv4k/Show B' },
    ]),
    { groups: { '/tv': [1], '/tv4k': [2] }, unresolved: [] }
  );
});

Deno.test('rename folder groups: nested roots never share a batch', () => {
  assertEquals(
    groups([
      { id: 1, path: '/tv/Show A' },
      { id: 2, path: '/tv/anime/Show B' },
      { id: 3, path: '/tv/Show C' },
    ]),
    { groups: { '/tv': [1, 3], '/tv/anime': [2] }, unresolved: [] }
  );
});

Deno.test('rename folder groups: Windows and UNC paths resolve to their parent', () => {
  assertEquals(
    groups([
      { id: 1, path: 'D:\\TV\\Show A' },
      { id: 2, path: 'D:\\TV4K\\Show B' },
      { id: 3, path: '\\\\nas\\media\\tv\\Show C' },
    ]),
    { groups: { 'D:\\TV': [1], 'D:\\TV4K': [2], '\\\\nas\\media\\tv': [3] }, unresolved: [] }
  );
});

Deno.test('rename folder groups: trailing separators do not change the parent', () => {
  assertEquals(
    groups([
      { id: 1, path: '/tv/Show A/' },
      { id: 2, path: 'D:\\TV\\Show B\\' },
    ]),
    { groups: { '/tv': [1], 'D:\\TV': [2] }, unresolved: [] }
  );
});

Deno.test('rename folder groups: series at a filesystem root keep that root', () => {
  assertEquals(parentFolderOf('/Show'), '/');
  assertEquals(parentFolderOf('D:\\Show'), 'D:\\');
});

Deno.test('rename folder groups: missing or unresolvable paths are reported, not sent', () => {
  assertEquals(
    groups([
      { id: 1 },
      { id: 2, path: '' },
      { id: 3, path: 'Show' },
      { id: 4, path: '/' },
      { id: 5, path: '/tv/Show E' },
    ]),
    { groups: { '/tv': [5] }, unresolved: [1, 2, 3, 4] }
  );
});
