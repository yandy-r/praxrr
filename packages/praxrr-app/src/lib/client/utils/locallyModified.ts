import { browser } from '$app/environment';
import type { LocallyModifiable } from '$shared/pcd/display/common.ts';

export function filterLocallyModified<T extends LocallyModifiable>(rows: T[], onlyLocal: boolean): T[] {
  return onlyLocal ? rows.filter((row) => row.locallyModified === true) : rows;
}

export function countLocallyModified(rows: readonly LocallyModifiable[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.locallyModified === true) count++;
  }
  return count;
}

export function loadLocalOnly(key: string): boolean {
  if (!browser) return false;
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function saveLocalOnly(key: string, value: boolean): void {
  if (!browser) return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures (private mode, quota); the filter is a convenience preference.
  }
}
