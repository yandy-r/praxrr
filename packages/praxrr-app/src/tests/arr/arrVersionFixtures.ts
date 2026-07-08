/**
 * Shared fixtures for the resilient Arr API adapter layer test slice.
 *
 * Two concerns live here:
 *  1. A golden `(arrType, version) -> expectedTier` table covering the
 *     supported / degraded / unsupported / unknown / malformed dimensions. It is
 *     a superset of `ARR_SUPPORT_NON_REGRESSION_CHECK` plus the fail-soft edges
 *     (undetected + unparseable versions, and an untracked arr_type).
 *  2. Minimal `BaseArrClient`-shaped mocks used to drive the server detection
 *     glue (`detectAndRecordArrVersion`) without any real network client.
 *
 * The `BaseArrClient` reference is a type-only import, so it is erased at compile
 * time and never pulls the server client module into a bundle.
 */
import type { ArrSupportTier } from '$shared/arr/compatibility.ts';
import type { BaseArrClient } from '$arr/base.ts';

/** A single tier-resolution expectation for `resolveArrCompatibility`. */
export interface ArrTierCase {
  /** Echoed `arr_type` (may be an untracked value such as `chaptarr`). */
  arrType: string;
  /** Raw reported version, or `null` when never detected. */
  version: string | null;
  /** Expected coarse support tier. */
  expectedTier: ArrSupportTier;
  /** Human-readable rationale for the expected tier. */
  note: string;
}

/**
 * Tier expectations for `resolveArrCompatibility(arrType, version)`. Covers each
 * tier plus the malformed / undetected / untracked fail-soft cases.
 */
export const ARR_TIER_CASES: readonly ArrTierCase[] = [
  // ---- radarr: min 4.0.0.0 / rec 5.0.0.0 / tested 5.14.0.9383 ----
  { arrType: 'radarr', version: '5.14.0.9383', expectedTier: 'supported', note: 'latest tested' },
  { arrType: 'radarr', version: '5.0.0.0', expectedTier: 'supported', note: 'at recommended' },
  { arrType: 'radarr', version: '5.99.0.0', expectedTier: 'supported', note: 'newer than tested is still supported' },
  { arrType: 'radarr', version: '4.7.5.0', expectedTier: 'degraded', note: 'below recommended, above minimum' },
  { arrType: 'radarr', version: '3.2.2.0', expectedTier: 'unsupported', note: 'below minimum' },
  { arrType: 'radarr', version: null, expectedTier: 'unknown', note: 'never detected' },
  { arrType: 'radarr', version: 'not-a-version', expectedTier: 'unknown', note: 'unparseable' },

  // ---- sonarr: min 3.0.0.0 / rec 4.0.0.0 / tested 4.0.15.2941 ----
  { arrType: 'sonarr', version: '4.0.15.2941', expectedTier: 'supported', note: 'latest tested' },
  { arrType: 'sonarr', version: '3.0.10.0', expectedTier: 'degraded', note: 'below recommended, above minimum' },
  { arrType: 'sonarr', version: '2.0.0.0', expectedTier: 'unsupported', note: 'below minimum' },

  // ---- lidarr: min 2.0.0.0 / no recommended / tested 2.9.6.4552 ----
  { arrType: 'lidarr', version: '2.9.6.4552', expectedTier: 'supported', note: 'latest tested' },
  { arrType: 'lidarr', version: '2.0.0.0', expectedTier: 'supported', note: 'at minimum, no recommended floor' },
  { arrType: 'lidarr', version: '1.9.9.9', expectedTier: 'unsupported', note: 'below minimum' },

  // ---- untracked arr_type ----
  { arrType: 'chaptarr', version: '5.0.0.0', expectedTier: 'unknown', note: 'not a tracked ArrAppType' },
];

/**
 * Build a `BaseArrClient`-shaped stub whose `getSystemStatus()` reports a healthy
 * probe with the given version. Cast through `unknown` because only the two
 * methods the detection glue touches are implemented.
 */
export function makeSystemStatusMock(version: string, appName = 'Radarr'): BaseArrClient {
  return {
    getSystemStatus: () => Promise.resolve({ ok: true as const, appName, version }),
    close: () => {},
  } as unknown as BaseArrClient;
}

/**
 * Build a `BaseArrClient`-shaped stub whose `getSystemStatus()` reports an
 * unreachable instance (`ok: false`), so detection must return `null` without
 * persisting anything.
 */
export function makeUnreachableMock(): BaseArrClient {
  return {
    getSystemStatus: () => Promise.resolve({ ok: false as const }),
    close: () => {},
  } as unknown as BaseArrClient;
}
