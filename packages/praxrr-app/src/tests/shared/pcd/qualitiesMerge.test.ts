import { assertEquals, assertNotStrictEquals } from '@std/assert';
import { get } from 'svelte/store';
import type { OrderedItem, QualitiesEditorData } from '$shared/pcd/display.ts';
import { buildAppScopeLabels, buildMergedOrderedItems, buildQualitiesFormData } from '$shared/pcd/qualities/merge.ts';
import { clear, current, initEdit, isDirty, update } from '$lib/client/stores/dirty.ts';

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

const EDITOR_DATA: Pick<QualitiesEditorData, 'orderedItems' | 'availableQualities' | 'targetArrTypes'> = {
  orderedItems: STORED,
  availableQualities: [
    { name: 'HDTV-720p', arrTypes: ['radarr', 'sonarr'] },
    { name: 'Remux-1080p', arrTypes: ['radarr'] },
  ],
  targetArrTypes: ['radarr', 'sonarr'],
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
  const merged = buildMergedOrderedItems({
    orderedItems: [],
    availableQualities: [{ name: 'FLAC', arrTypes: ['lidarr'] }],
  });

  assertEquals(merged, [{ type: 'quality', name: 'FLAC', position: 0, enabled: false, upgradeUntil: false }]);
});

Deno.test('qualities editor dirty state: clean on load, dirty after enabling an addition, clean when reverted', () => {
  try {
    initEdit(buildQualitiesFormData(EDITOR_DATA));
    assertEquals(get(isDirty), false);

    const items = get(current).orderedItems as OrderedItem[];
    const additionIndex = items.findIndex((item) => item.name === 'Remux-1080p');
    const toggled = items.map((item, index) => (index === additionIndex ? { ...item, enabled: true } : item));
    update('orderedItems', toggled);
    assertEquals(get(isDirty), true);

    update('orderedItems', items);
    assertEquals(get(isDirty), false);
  } finally {
    clear();
  }
});

Deno.test('buildAppScopeLabels: labels only additions a strict subset of target apps support', () => {
  const labels = buildAppScopeLabels(EDITOR_DATA);

  assertEquals([...labels.entries()], [['Remux-1080p', 'Radarr only']]);
});

Deno.test('buildAppScopeLabels: single target app never labels additions', () => {
  const labels = buildAppScopeLabels({
    availableQualities: [{ name: 'DVDSCR', arrTypes: ['radarr'] }],
    targetArrTypes: ['radarr'],
  });

  assertEquals(labels.size, 0);
});
