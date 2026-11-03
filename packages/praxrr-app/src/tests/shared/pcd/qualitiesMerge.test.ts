import { assertEquals, assertNotStrictEquals } from '@std/assert';
import type { OrderedItem } from '$shared/pcd/display.ts';
import { buildMergedOrderedItems, buildQualitiesFormData } from '$shared/pcd/qualities/merge.ts';

// Stored positions are deliberately sparse (as persisted rows can be) to prove they are not renumbered.
const STORED: OrderedItem[] = [
  { type: 'quality', name: 'Bluray-1080p', position: 1, enabled: true, upgradeUntil: true },
  {
    type: 'group',
    name: 'HD Web',
    position: 4,
    enabled: true,
    upgradeUntil: false,
    members: [{ name: 'WEBDL-1080p' }, { name: 'WEBRip-1080p' }],
  },
  { type: 'quality', name: 'DVDSCR', position: 2, enabled: false, upgradeUntil: false },
];

const EDITOR_DATA = {
  orderedItems: STORED,
  availableQualities: [{ name: 'HDTV-720p' }, { name: 'Remux-1080p' }],
};

Deno.test('buildMergedOrderedItems: preserves stored positions and appends disabled additions after max', () => {
  const merged = buildMergedOrderedItems(EDITOR_DATA);

  assertEquals(merged, [
    ...STORED,
    { type: 'quality', name: 'HDTV-720p', position: 5, enabled: false, upgradeUntil: false },
    { type: 'quality', name: 'Remux-1080p', position: 6, enabled: false, upgradeUntil: false },
  ]);
  // Input must not be mutated or aliased (the dirty store snapshots and mutates its copy).
  assertNotStrictEquals(merged[0], STORED[0]);
  assertEquals(STORED[1].position, 4);
});

Deno.test('buildMergedOrderedItems: empty stored ladder numbers additions from 0', () => {
  const merged = buildMergedOrderedItems({ orderedItems: [], availableQualities: [{ name: 'FLAC' }] });

  assertEquals(merged, [{ type: 'quality', name: 'FLAC', position: 0, enabled: false, upgradeUntil: false }]);
});

Deno.test('buildMergedOrderedItems: no additions returns the stored ladder unchanged', () => {
  assertEquals(buildMergedOrderedItems({ orderedItems: STORED, availableQualities: [] }), STORED);
});

Deno.test('buildQualitiesFormData: dirty baseline deep-equals the rendered merged list', () => {
  const baseline = buildQualitiesFormData(EDITOR_DATA);

  assertEquals(baseline, { orderedItems: buildMergedOrderedItems(EDITOR_DATA) });
  assertEquals(baseline.orderedItems.length, STORED.length + EDITOR_DATA.availableQualities.length);
});
