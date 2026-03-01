import { browser } from '$app/environment';
import type { SourceRef, SourceKind } from '$shared/sources/types.ts';

export type SourceFilterKey = `${SourceRef['type']}:${number}`;
export type SourceFilterSelection = SourceFilterKey[];

export interface SourceFilterItem {
  sourceType?: SourceKind;
  sourceDatabaseId?: number;
}

export function toSourceFilterKey(source: Pick<SourceRef, 'type' | 'id'>): SourceFilterKey {
  return `${source.type}:${source.id}`;
}

export function sameSelection(a: SourceFilterSelection, b: SourceFilterSelection): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function normalizeSourceSelection(
  selection: string[],
  sources: readonly SourceRef[],
  defaultKey: string,
  selectAllSourcesByDefault = false
): SourceFilterSelection {
  if (sources.length === 0) return [];

  const availableKeys = sources.map((source) => toSourceFilterKey(source));
  const availableSet = new Set(availableKeys);
  const selected = [
    ...new Set(selection.filter((key) => availableSet.has(key as SourceFilterKey))),
  ] as SourceFilterSelection;

  if (selected.length > 0) {
    return selected;
  }

  if (selectAllSourcesByDefault) {
    return [...availableKeys];
  }

  if (availableSet.has(defaultKey as SourceFilterKey)) {
    return [defaultKey as SourceFilterKey];
  }

  return [availableKeys[0]];
}

export function loadSourceSelection(
  storageKey: string,
  sources: readonly SourceRef[],
  defaultKey: string,
  selectAllSourcesByDefault = false
): SourceFilterSelection {
  if (!browser) {
    return normalizeSourceSelection([], sources, defaultKey, selectAllSourcesByDefault);
  }

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return normalizeSourceSelection(
          parsed.filter((value) => typeof value === 'string'),
          sources,
          defaultKey,
          selectAllSourcesByDefault
        );
      }
    }
  } catch {
    // Ignore parse errors and fall back to defaults.
  }

  return normalizeSourceSelection([], sources, defaultKey, selectAllSourcesByDefault);
}

export function resolveSourceKey(item: SourceFilterItem, fallbackSourceKey: SourceFilterKey): SourceFilterKey {
  if (item.sourceType && typeof item.sourceDatabaseId === 'number') {
    return `${item.sourceType}:${item.sourceDatabaseId}`;
  }

  return fallbackSourceKey;
}

export function filterBySourceSelection<T extends SourceFilterItem>(
  items: T[],
  selectedKeys: SourceFilterSelection,
  fallbackSourceKey: SourceFilterKey
): T[] {
  if (selectedKeys.length === 0) return items;

  const selectedSet = new Set(selectedKeys);
  return items.filter((item) => selectedSet.has(resolveSourceKey(item, fallbackSourceKey)));
}

export function isCurrentDatabasePcdItem(item: SourceFilterItem, currentDatabaseId: number): boolean {
  const sourceType = item.sourceType ?? 'pcd';
  const sourceDatabaseId = item.sourceDatabaseId ?? currentDatabaseId;
  return sourceType === 'pcd' && sourceDatabaseId === currentDatabaseId;
}

export function isSourceFilterActive(selectedKeys: SourceFilterSelection, sources: readonly SourceRef[]): boolean {
  if (sources.length === 0) return false;

  const allKeys = sources.map((source) => toSourceFilterKey(source));
  if (selectedKeys.length !== allKeys.length) return true;

  const selectedSet = new Set(selectedKeys);
  return allKeys.some((key) => !selectedSet.has(key));
}

export function allSourceKeys(sources: readonly SourceRef[]): SourceFilterSelection {
  return sources.map((source) => toSourceFilterKey(source));
}
