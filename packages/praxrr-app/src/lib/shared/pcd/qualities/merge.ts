/**
 * Qualities editor list building (pure, shared by the page and its tests)
 */

import type { OrderedItem, QualitiesEditorData } from '$shared/pcd/display.ts';

/** Dirty-tracking form shape of the qualities editor */
export interface QualitiesFormData {
  orderedItems: OrderedItem[];
  [key: string]: unknown;
}

/**
 * Stored ladder followed by the profile's addable qualities as disabled items.
 *
 * Stored items keep their persisted positions (unsaved views must not rewrite them); additions are
 * numbered after the highest stored position. Returns fresh objects; the input is not mutated.
 */
export function buildMergedOrderedItems(
  qualities: Pick<QualitiesEditorData, 'orderedItems' | 'availableQualities'>
): OrderedItem[] {
  const orderedItems = structuredClone(qualities.orderedItems);
  const nextPosition = orderedItems.reduce((max, item) => Math.max(max, item.position), -1) + 1;
  const additions: OrderedItem[] = qualities.availableQualities.map((quality, index) => ({
    type: 'quality',
    name: quality.name,
    position: nextPosition + index,
    enabled: false,
    upgradeUntil: false,
  }));

  return [...orderedItems, ...additions];
}

/**
 * Dirty-tracking baseline: exactly the list the editor renders on load, so an untouched page is
 * never dirty.
 */
export function buildQualitiesFormData(
  qualities: Pick<QualitiesEditorData, 'orderedItems' | 'availableQualities'>
): QualitiesFormData {
  return { orderedItems: buildMergedOrderedItems(qualities) };
}
