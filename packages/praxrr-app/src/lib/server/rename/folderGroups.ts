/**
 * Folder grouping for Sonarr folder renames.
 *
 * `PUT /series/editor { rootFolderPath, moveFiles: true }` moves every listed series into
 * `rootFolderPath`, so each batch must contain only series whose current parent directory is
 * exactly that path. Matching by string prefix would relocate series between sibling roots
 * (`/tv` vs `/tv4k`) or nested roots (`/tv` vs `/tv/anime`).
 */

const DRIVE_ONLY = /^[A-Za-z]:$/;
const UNC_HOST_ONLY = /^\\\\[^\\/]+$/;

/**
 * Parent directory of a series path, accepting `/` and `\` separators.
 * Returns null when the path has no parent folder Sonarr could accept as a root.
 */
export function parentFolderOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separatorIndex < 0) return null;
  if (separatorIndex === 0) return trimmed[0];

  const parent = trimmed.slice(0, separatorIndex);
  if (DRIVE_ONLY.test(parent)) return `${parent}${trimmed[separatorIndex]}`;
  if (UNC_HOST_ONLY.test(parent)) return null;
  return parent;
}

/**
 * Batch series by exact parent folder. Series without a resolvable parent are returned in
 * `unresolved` so callers can report them instead of sending them to Sonarr.
 */
export function groupSeriesByParentFolder<T extends { id: number; path?: string }>(
  series: readonly T[]
): { groups: Map<string, number[]>; unresolved: T[] } {
  const groups = new Map<string, number[]>();
  const unresolved: T[] = [];

  for (const item of series) {
    const parent = item.path ? parentFolderOf(item.path) : null;
    if (parent === null) {
      unresolved.push(item);
      continue;
    }
    const ids = groups.get(parent);
    if (ids) ids.push(item.id);
    else groups.set(parent, [item.id]);
  }

  return { groups, unresolved };
}
