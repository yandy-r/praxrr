import { assertEquals } from '@std/assert';
import { mergePreviewFormatIdMap } from '../../lib/server/sync/qualityProfiles/syncer.ts';

Deno.test('mergePreviewFormatIdMap adds preview-created custom formats', () => {
  const existing = new Map<string, number>([
    ['Existing-A', 101],
    ['Existing-B', 102],
  ]);

  const merged = mergePreviewFormatIdMap(existing, [
    {
      arrFormat: {
        name: 'Preview-New',
        id: -1,
      },
    },
  ]);

  assertEquals(merged.get('Existing-A'), 101);
  assertEquals(merged.get('Existing-B'), 102);
  assertEquals(merged.get('Preview-New'), -1);
});

Deno.test('mergePreviewFormatIdMap ignores preview formats without ids', () => {
  const existing = new Map<string, number>([['Existing-A', 101]]);

  const merged = mergePreviewFormatIdMap(existing, [
    {
      arrFormat: {
        name: 'No-Id',
      },
    },
  ]);

  assertEquals(merged.get('Existing-A'), 101);
  assertEquals(merged.has('No-Id'), false);
});

Deno.test('mergePreviewFormatIdMap keeps newest id when names collide', () => {
  const existing = new Map<string, number>([['Colliding-Name', 101]]);

  const merged = mergePreviewFormatIdMap(existing, [
    {
      arrFormat: {
        name: 'Colliding-Name',
        id: -7,
      },
    },
  ]);

  assertEquals(merged.get('Colliding-Name'), -7);
});
