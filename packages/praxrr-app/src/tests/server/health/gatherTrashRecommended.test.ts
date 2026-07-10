/**
 * Unit tests for the TRaSH reference-set resolver behind config-health `trash_alignment` (issue #225).
 *
 * Stubs `trashGuideSyncQueries.getSelectionsByInstance` (patchTarget precedent from
 * `tests/base/trashGuideSyncSourceScope.test.ts`) so no DB/migration is required — the resolver's
 * own concerns (arr scoping, section filter, distinct/lower-case dedup, never-throw) are what we pin.
 */

import { assertEquals } from '@std/assert';
import { gatherTrashRecommendedCfNames } from '../../../lib/server/health/gather.ts';
import { trashGuideSyncQueries, type TrashGuideSyncSelection } from '../../../lib/server/db/queries/trashGuideSync.ts';

type Restore = () => void;

/** Swap `getSelectionsByInstance` for the duration of one test; `rows` may be a thrower. */
function patchSelections(rows: TrashGuideSyncSelection[] | (() => never), restores: Restore[]): void {
  const original = trashGuideSyncQueries.getSelectionsByInstance;
  trashGuideSyncQueries.getSelectionsByInstance = (typeof rows === 'function' ? rows : () => rows) as typeof original;
  restores.push(() => {
    trashGuideSyncQueries.getSelectionsByInstance = original;
  });
}

const sel = (itemName: string, sectionType: TrashGuideSyncSelection['sectionType']): TrashGuideSyncSelection => ({
  instanceId: 1,
  sourceId: 9,
  sectionType,
  itemName,
});

Deno.test('gatherTrashRecommendedCfNames: lidarr short-circuits to null (never queries)', () => {
  assertEquals(gatherTrashRecommendedCfNames(1, 'lidarr'), null);
});

Deno.test('gatherTrashRecommendedCfNames: filters to the customFormats section only', () => {
  const restores: Restore[] = [];
  patchSelections([sel('CF-A', 'customFormats'), sel('QP-1', 'qualityProfiles')], restores);
  try {
    assertEquals(gatherTrashRecommendedCfNames(1, 'radarr'), ['CF-A']);
  } finally {
    restores.forEach((r) => r());
  }
});

Deno.test('gatherTrashRecommendedCfNames: dedupes case-insensitively, keeps first original case', () => {
  const restores: Restore[] = [];
  patchSelections([sel('CF-A', 'customFormats'), sel('cf-a', 'customFormats'), sel('CF-B', 'customFormats')], restores);
  try {
    assertEquals(gatherTrashRecommendedCfNames(1, 'sonarr'), ['CF-A', 'CF-B']);
  } finally {
    restores.forEach((r) => r());
  }
});

Deno.test('gatherTrashRecommendedCfNames: no customFormats selections => null (unmeasurable)', () => {
  const restores: Restore[] = [];
  patchSelections([sel('QP-1', 'qualityProfiles')], restores);
  try {
    assertEquals(gatherTrashRecommendedCfNames(1, 'radarr'), null);
  } finally {
    restores.forEach((r) => r());
  }
});

Deno.test('gatherTrashRecommendedCfNames: read error degrades to null, never throws', () => {
  const restores: Restore[] = [];
  patchSelections(() => {
    throw new Error('db down');
  }, restores);
  try {
    assertEquals(gatherTrashRecommendedCfNames(1, 'sonarr'), null);
  } finally {
    restores.forEach((r) => r());
  }
});
