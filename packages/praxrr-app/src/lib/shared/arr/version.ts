/**
 * Pure, client-safe Arr application-version model.
 *
 * Arr apps report a `major.minor.patch.build` version string (e.g. Radarr
 * `"5.14.0.9383"`). This module parses that grammar and compares two versions
 * numerically. It imports nothing outside `$shared` so it is safe in both the
 * server and the client (svelte) bundles.
 *
 * Parsing is fail-soft: malformed / empty / undefined input yields `null` and
 * never throws, so an unrecognized version string can never brick a call site.
 */

/** A parsed Arr application version. `raw` preserves the original string. */
export interface ArrVersion {
  major: number;
  minor: number;
  patch: number;
  build: number;
  raw: string;
}

const SEGMENT = /^\d+$/;

/**
 * Parse an Arr `major.minor.patch[.build]` version string.
 *
 * Accepts 3-part (`build` defaults to `0`) or 4-part strings whose segments are
 * all non-negative integers. Empty, non-numeric, over-long (>4 segments), or
 * `null`/`undefined` input returns `null`. Never throws.
 */
export function parseArrVersion(raw: string | null | undefined): ArrVersion | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const segments = trimmed.split('.');
  if (segments.length < 3 || segments.length > 4) return null;
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;

  const [major, minor, patch, build] = segments.map((segment) => Number.parseInt(segment, 10));

  return { major, minor, patch, build: build ?? 0, raw: trimmed };
}

/**
 * Compare two parsed versions segment-by-segment, numerically (so `5.9.0` sorts
 * below `5.14.0`, never lexically). Returns `-1` when `a < b`, `1` when `a > b`,
 * and `0` when equal.
 */
export function compareArrVersions(a: ArrVersion, b: ArrVersion): -1 | 0 | 1 {
  const segments: Array<keyof Pick<ArrVersion, 'major' | 'minor' | 'patch' | 'build'>> = [
    'major',
    'minor',
    'patch',
    'build',
  ];

  for (const segment of segments) {
    if (a[segment] < b[segment]) return -1;
    if (a[segment] > b[segment]) return 1;
  }

  return 0;
}

/**
 * Compare a parsed version against a boundary version string. Returns `null`
 * when the boundary string cannot be parsed (an authoring error the resolver
 * treats as "boundary not applicable"), otherwise the numeric comparison.
 */
export function compareArrVersionToBoundary(version: ArrVersion, boundary: string): -1 | 0 | 1 | null {
  const parsed = parseArrVersion(boundary);
  return parsed ? compareArrVersions(version, parsed) : null;
}
