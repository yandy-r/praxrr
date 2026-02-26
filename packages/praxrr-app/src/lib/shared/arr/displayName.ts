import { isArrAppType, getArrAppMetadata } from '$shared/arr/capabilities.ts';
import type { SourceKind } from '$shared/sources/types.ts';

/**
 * Capitalize the first letter of a string.
 */
function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Friendly display name for a TRaSH source in source filters/badges.
 * Example: `radarr` -> `Radarr (TRaSH)`.
 */
export function getTrashSourceDisplayName(arrType: string): string {
  const label = isArrAppType(arrType) ? getArrAppMetadata(arrType).label : capitalize(arrType);
  return `${label} (TRaSH)`;
}

/**
 * Derive a friendly base label from a TRaSH entity name.
 * Strips known suffixes (`-naming`) and resolves arr-type slugs
 * to their canonical labels: `radarr-naming` -> `Radarr`.
 */
function friendlyTrashEntityLabel(name: string): string {
  const stripped = name.replace(/-naming$/i, '');
  if (isArrAppType(stripped)) {
    return getArrAppMetadata(stripped).label;
  }
  return capitalize(stripped);
}

/**
 * Display name for media-management entities.
 * TRaSH-sourced rows get a `(TRaSH)` suffix: `movie` -> `Movie (TRaSH)`,
 * `radarr-naming` -> `Radarr (TRaSH)`.
 * PCD rows are returned unchanged.
 */
export function getMediaManagementDisplayName(name: string, arrType: string, sourceType?: SourceKind): string {
  void arrType;
  if (sourceType === 'trash') {
    return `${friendlyTrashEntityLabel(name)} (TRaSH)`;
  }
  return name;
}

/**
 * Raw name for route segments — never decorated.
 */
export function getMediaManagementRouteName(name: string, arrType: string): string {
  return name;
  void arrType;
}
